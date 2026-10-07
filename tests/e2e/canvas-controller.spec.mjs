import { expect, test } from "@playwright/test";

import { DRAFT_ORIGIN as dev, pageProblems, settle, useManualFrames, useReducedMotion, VIEWPORTS, pendingFrames, stepFrame } from "./fixtures.mjs";

const lifetimes = (page) => page.evaluate(() => window.__lifetimes());
const clock = (page) => page.evaluate(() => {
  const { elapsed, activeTime, reduced, ratio } = window.__handle.state;
  return { elapsed, activeTime, reduced, ratio };
});

/** Count live observers and controller listeners. Keep native observer delivery. */
async function useLifetimeSpy(page) {
  await page.addInitScript(() => {
    const live = { resize: new Set(), intersection: new Set() };
    const listeners = new Map(["visibilitychange", "pagehide", "pageshow", "preference"].map((name) => [name, new Set()]));
    window.__observers = { resize: [], intersection: [] };
    for (const [name, type] of [["resize", "ResizeObserver"], ["intersection", "IntersectionObserver"]]) {
      const Observer = window[type];
      window[type] = class extends Observer {
        constructor(callback) {
          super(callback);
          window.__observers[name].push({ observer: this, callback });
        }
        observe(...args) {
          super.observe(...args);
          live[name].add(this);
          if (name === "intersection" && window.__failIntersection) throw new Error("Observe failed");
        }
        disconnect() {
          super.disconnect();
          live[name].delete(this);
        }
      };
    }
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    const key = (target, type) => {
      if (target === document && type === "visibilitychange") return type;
      if (target === window && (type === "pagehide" || type === "pageshow")) return type;
      if (target instanceof MediaQueryList && type === "change" && target.media.includes("prefers-reduced-motion")) return "preference";
    };
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      const name = key(this, type);
      if (name) listeners.get(name).add(listener);
      return add.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function (type, listener, options) {
      const name = key(this, type);
      if (name) listeners.get(name).delete(listener);
      return remove.call(this, type, listener, options);
    };
    window.__lifetimes = () => ({
      resize: live.resize.size,
      intersection: live.intersection.size,
      ...Object.fromEntries([...listeners].map(([name, list]) => [name, list.size])),
    });
  });
}

/** Mount a small scene through the real controller. Read its public handle. */
async function mountScene(page, policy, { duration = 2300, busy = false, count = 1 } = {}) {
  await useManualFrames(page);
  await useLifetimeSpy(page);
  const url = `${dev}/__canvas-controller__/`;
  await page.route(url, (route) => route.fulfill({
    contentType: "text/html",
    body: "<!doctype html><html><head><title>Canvas controller test</title></head><body></body></html>",
  }));
  await page.goto(url);
  await page.evaluate(async (settings) => {
    const { mountCanvas } = await import("/src/lib/page-graphics/mount.ts");
    const { GLOBE_POLICY, mountCanvasController } = await import("/src/lib/motion/canvas-controller.ts");
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, get: () => 3 });
    window.__busy = settings.busy;
    window.__draws = 0;
    window.__builds = 0;
    window.__attached = 0;
    window.__detached = 0;
    window.__handles = [];
    window.__stateChanged = false;
    for (let i = 0; i < settings.count; i += 1) {
      const root = document.createElement("div");
      root.dataset.scene = String(i);
      root.style.cssText = "width:240px;height:160px;margin:24px";
      root.append(document.createElement("canvas"));
      root.firstElementChild.style.cssText = "display:block;width:100%;height:100%";
      document.body.append(root);
      let firstState;
      const options = {
        duration: settings.duration,
        onResize() {
          window.__builds += 1;
        },
        draw(ctx, state) {
          if (firstState && firstState !== state) window.__stateChanged = true;
          firstState = state;
          window.__draws += 1;
          ctx.drawImage(state.glow, 10, 10);
          ctx.fillRect(0, 0, state.progress * state.width, 1);
          return window.__busy && !state.reduced;
        },
        attach(handle) {
          window.__attached += 1;
          const wake = () => handle.wake();
          window.addEventListener("scenechange", wake);
          return () => {
            window.__detached += 1;
            window.removeEventListener("scenechange", wake);
          };
        },
      };
      const handle = settings.policy === "page"
        ? mountCanvas(root, options)
        : mountCanvasController(root, options, GLOBE_POLICY);
      window.__handles.push(handle);
    }
    window.__handle = window.__handles[0];
    const spacer = document.createElement("div");
    spacer.style.height = "3000px";
    document.body.append(spacer);
  }, { policy, duration, busy, count });
  await expect(page.locator("[data-scene][data-ready='true']")).toHaveCount(count);
  await expect.poll(() => pendingFrames(page)).toBe(count);
}

const setHidden = (page, hidden) => page.evaluate((value) => {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => value });
  document.dispatchEvent(new Event("visibilitychange"));
}, hidden);
const transition = (page, type, persisted = true) => page.evaluate(([name, saved]) => {
  window.dispatchEvent(new PageTransitionEvent(name, { persisted: saved }));
}, [type, persisted]);
const activeLifetime = { resize: 1, intersection: 1, visibilitychange: 1, pagehide: 1, pageshow: 1, preference: 1 };
const pausedLifetime = { ...activeLifetime, resize: 0, intersection: 0, visibilitychange: 0, preference: 0 };
const emptyLifetime = { resize: 0, intersection: 0, visibilitychange: 0, pagehide: 0, pageshow: 0, preference: 0 };

for (const policy of ["page", "globe"]) {
  test.describe(`${policy} canvas controller`, () => {
    test("caps the frame interval and keeps its pixel ratio policy", async ({ page }) => {
      await mountScene(page, policy);
      await page.evaluate(() => { window.__step(0); window.__step(1000); });
      // Every canvas shares the 64 ms frame interval cap.
      expect(await clock(page)).toEqual({
        elapsed: 64,
        activeTime: 64,
        reduced: false,
        ratio: policy === "page" ? 2 : 1.75,
      });
      expect(await page.evaluate(() => window.__stateChanged)).toBe(false);
      await expect(page.locator("[data-scene] canvas")).toHaveAttribute("width", policy === "page" ? "480" : "420");
    });

    test("excludes hidden and offscreen time from both clocks", async ({ page }) => {
      await mountScene(page, policy);
      await page.evaluate(() => { window.__step(0); window.__step(32); });
      await setHidden(page, true);
      expect(await pendingFrames(page)).toBe(0);
      await page.evaluate(() => window.__step(20000));
      expect((await clock(page)).activeTime).toBe(32);
      await setHidden(page, false);
      expect(await pendingFrames(page)).toBe(1);
      await page.evaluate(() => window.__step(30000));
      expect((await clock(page)).activeTime).toBe(32);
      await page.evaluate(() => window.__step(30016));
      expect((await clock(page)).activeTime).toBe(48);
      await page.evaluate(() => scrollTo(0, 2000));
      await expect.poll(() => pendingFrames(page)).toBe(0);
      await page.evaluate(() => window.__step(40000));
      expect((await clock(page)).elapsed).toBe(48);
      await page.evaluate(() => scrollTo(0, 0));
      await expect.poll(() => pendingFrames(page)).toBe(1);
      await page.evaluate(() => window.__step(50000));
      expect((await clock(page)).elapsed).toBe(48);
      await page.evaluate(() => window.__step(50016));
      expect((await clock(page)).elapsed).toBe(64);
    });

    test("restores one lifetime and rejects callbacks from previous observers", async ({ page }) => {
      await mountScene(page, policy);
      await page.evaluate(() => { window.__step(0); window.__step(32); });
      for (let cycle = 1; cycle <= 3; cycle += 1) {
        const saved = await clock(page);
        await transition(page, "pagehide");
        expect(await lifetimes(page)).toEqual(pausedLifetime);
        expect(await pendingFrames(page)).toBe(0);
        await expect(page.locator("[data-scene]")).not.toHaveAttribute("data-ready", /.*/);
        await transition(page, "pageshow", false);
        expect(await lifetimes(page)).toEqual(pausedLifetime);
        await transition(page, "pageshow");
        await expect(page.locator("[data-scene]")).toHaveAttribute("data-ready", "true");
        await expect.poll(() => pendingFrames(page)).toBe(1);
        await transition(page, "pageshow");
        expect(await lifetimes(page)).toEqual(activeLifetime);
        expect(await page.evaluate(() => window.__attached)).toBe(cycle + 1);
        expect(await page.evaluate(() => window.__detached)).toBe(cycle);
        const restored = policy === "page" ? saved : { ...saved, elapsed: 0, activeTime: 0 };
        expect(await clock(page)).toEqual(restored);
        const draws = await page.evaluate(() => window.__draws);
        await page.evaluate((old) => {
          window.__observers.resize[old].callback([{ contentRect: { width: 1, height: 1 } }]);
          window.__observers.intersection[old].callback([{ isIntersecting: false }]);
        }, cycle - 1);
        expect(await page.evaluate(() => window.__draws)).toBe(draws);
        expect(await pendingFrames(page)).toBe(1);
        await stepFrame(page, cycle * 10000);
        expect(await clock(page)).toEqual(restored);
        await page.evaluate((time) => window.__step(time + 16), cycle * 10000);
      }
      const draws = await page.evaluate(() => window.__draws);
      await page.evaluate(() => {
        window.__handle.destroy();
        window.__handle.destroy();
        window.__handle.wake();
        window.__handle.redraw();
        window.__handle.replay();
      });
      await transition(page, "pageshow");
      expect(await lifetimes(page)).toEqual(emptyLifetime);
      expect(await pendingFrames(page)).toBe(0);
      expect(await page.evaluate(() => window.__draws)).toBe(draws);
      expect(await page.evaluate(() => window.__detached)).toBe(4);
      await expect(page.locator("[data-scene]")).not.toHaveAttribute("data-ready", /.*/);
    });

    test("applies reduced motion changes in both directions", async ({ page }) => {
      await mountScene(page, policy, { busy: true });
      await page.evaluate(() => { window.__step(0); window.__step(32); });
      for (let cycle = 0; cycle < 2; cycle += 1) {
        await useReducedMotion(page);
        await expect(page.locator("[data-scene]")).toHaveAttribute("data-motion-state", "still");
        expect(await pendingFrames(page)).toBe(0);
        expect(await clock(page)).toEqual({ elapsed: 2300, activeTime: 0, reduced: true, ratio: policy === "page" ? 2 : 1.75 });
        await useReducedMotion(page, "no-preference");
        await expect(page.locator("[data-scene]")).toHaveAttribute("data-motion-state", "playing");
        expect(await pendingFrames(page)).toBe(1);
        expect((await clock(page)).reduced).toBe(false);
        await page.evaluate(() => { window.__step(90000); window.__step(90016); });
        expect((await clock(page)).activeTime).toBe(16);
        expect(await lifetimes(page)).toEqual(activeLifetime);
      }
    });

    test("wakes an idle scene without consuming idle time", async ({ page }) => {
      await mountScene(page, policy, { duration: 32 });
      await page.evaluate(() => { window.__step(0); window.__step(16); window.__step(32); });
      expect(await pendingFrames(page)).toBe(0);
      await expect(page.locator("[data-scene]")).toHaveAttribute("data-motion-state", "still");
      const saved = await clock(page);
      const draws = await page.evaluate(() => window.__draws);
      await page.evaluate(() => window.dispatchEvent(new Event("scenechange")));
      expect(await pendingFrames(page)).toBe(1);
      await page.evaluate(() => window.__step(90000));
      expect(await clock(page)).toEqual(saved);
      expect(await page.evaluate(() => window.__draws)).toBe(draws + 1);
      expect(await pendingFrames(page)).toBe(0);
    });
  });
}

/** Hold reduced-motion change events until the test runs them, so a rebuild can come first. */
async function useDeferredPreference(page) {
  await page.addInitScript(() => {
    const add = MediaQueryList.prototype.addEventListener;
    const remove = MediaQueryList.prototype.removeEventListener;
    const wrappers = new WeakMap();
    window.__preferenceJobs = [];
    MediaQueryList.prototype.addEventListener = function (type, listener, options) {
      if (type !== "change" || !this.media.includes("prefers-reduced-motion")) return add.call(this, type, listener, options);
      const wrapped = (event) => window.__preferenceJobs.push(() => listener.call(this, event));
      wrappers.set(listener, wrapped);
      return add.call(this, type, wrapped, options);
    };
    MediaQueryList.prototype.removeEventListener = function (type, listener, options) {
      return remove.call(this, type, wrappers.get(listener) ?? listener, options);
    };
  });
}

for (const policy of ["page", "globe"]) {
  test(`${policy} rebuild applies a pending motion preference before it draws`, async ({ page }) => {
    await useDeferredPreference(page);
    await mountScene(page, policy, { busy: true });
    const scene = page.locator("[data-scene]");
    const ratio = policy === "page" ? 2 : 1.75;
    await page.evaluate(() => { window.__step(0); window.__step(32); });
    const builds = await page.evaluate(() => window.__builds);

    // The preference changes, but its event waits. A rebuild comes first.
    await useReducedMotion(page);
    await expect.poll(() => page.evaluate(() => window.__preferenceJobs.length)).toBe(1);
    expect((await clock(page)).reduced).toBe(false);
    await page.evaluate(() => window.__handle.rebuild());
    expect(await page.evaluate(() => window.__builds)).toBe(builds + 1);
    expect(await clock(page)).toEqual({ elapsed: 2300, activeTime: 0, reduced: true, ratio });
    await expect(scene).toHaveAttribute("data-motion-state", "still");
    expect(await pendingFrames(page)).toBe(0);
    // The late event finds the preference applied and changes nothing.
    await page.evaluate(() => window.__preferenceJobs.shift()());
    expect(await clock(page)).toEqual({ elapsed: 2300, activeTime: 0, reduced: true, ratio });
    await expect(scene).toHaveAttribute("data-motion-state", "still");
    expect(await pendingFrames(page)).toBe(0);

    // The same order works when motion comes back.
    await useReducedMotion(page, "no-preference");
    await expect.poll(() => page.evaluate(() => window.__preferenceJobs.length)).toBe(1);
    await page.evaluate(() => window.__handle.rebuild());
    expect((await clock(page)).reduced).toBe(false);
    await expect(scene).toHaveAttribute("data-motion-state", "playing");
    expect(await pendingFrames(page)).toBe(1);
    await page.evaluate(() => window.__preferenceJobs.shift()());
    expect(await pendingFrames(page)).toBe(1);

    // A rebuild after teardown does nothing.
    await transition(page, "pagehide");
    const draws = await page.evaluate(() => window.__draws);
    await page.evaluate(() => window.__handle.rebuild());
    expect(await page.evaluate(() => [window.__draws, window.__builds])).toEqual([draws, builds + 2]);
    expect(await pendingFrames(page)).toBe(0);
  });
}

test("keeps a shared cached glow after one scene stops", async ({ page }) => {
  await mountScene(page, "page", { count: 2 });
  expect(await page.evaluate(() => window.__handles[0].state.glow === window.__handles[1].state.glow)).toBe(true);
  await page.evaluate(() => {
    window.__handles[0].destroy();
    window.__handles[1].replay();
    window.__step(0);
    window.__step(16);
  });
  expect(await page.evaluate(() => {
    const glow = window.__handles[1].state.glow;
    return { width: glow.width, height: glow.height };
  })).toEqual({ width: 96, height: 96 });
  expect(await lifetimes(page)).toEqual(activeLifetime);
  expect(await pendingFrames(page)).toBe(1);
  await expect(page.locator("[data-scene='1']")).toHaveAttribute("data-ready", "true");
});

const scenes = [
  { name: "globe", route: "/", selector: "[data-lyra-globe]", heading: "Cristian Vega" },
  { name: "page", route: "/about/", selector: "[data-graphic='about']", heading: "Cristian Vega" },
];
for (const scene of scenes) {
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    test(`${scene.name} keeps its canvas and content at ${name} width`, async ({ page }) => {
      const problems = pageProblems(page, ["warning", "error"]);
      await page.setViewportSize(viewport);
      await useManualFrames(page);
      await page.goto(scene.route);
      await expect(page.locator(scene.selector)).toHaveAttribute("data-ready", "true");
      await expect.poll(() => pendingFrames(page)).toBe(1);
      await useReducedMotion(page);
      await expect(page.locator(scene.selector)).toHaveAttribute("data-motion-state", "still");
      expect(await pendingFrames(page)).toBe(0);
      await settle(page);
      await expect(page.locator("h1")).toHaveText(scene.heading);
      await expect(page.locator("h1")).toBeVisible();
      const sizes = await page.locator(`${scene.selector} canvas`).evaluate((canvas) => new Promise((resolve) => {
        const observer = new ResizeObserver(([entry]) => {
          observer.disconnect();
          const [device] = entry.devicePixelContentBoxSize;
          resolve({ bitmap: [canvas.width, canvas.height], device: [device.inlineSize, device.blockSize] });
        });
        observer.observe(canvas, { box: "device-pixel-content-box" });
      }));
      expect(sizes.bitmap, "the bitmap has the device pixels that show the canvas, so the screen does not resample it").toEqual(sizes.device);
      await useReducedMotion(page, "no-preference");
      await expect(page.locator(scene.selector)).toHaveAttribute("data-motion-state", "still");
      expect(await pendingFrames(page)).toBe(0);
      await transition(page, "pagehide");
      await transition(page, "pageshow");
      await expect(page.locator(scene.selector)).toHaveAttribute("data-ready", "true");
      await expect.poll(() => pendingFrames(page)).toBe(1);
      if (scene.name === "page") {
        // The scroll reader requests one refresh when it reconnects.
        await page.evaluate(() => window.__step(90000));
        await expect(page.locator(scene.selector)).toHaveAttribute("data-motion-state", "still");
        expect(await pendingFrames(page)).toBe(0);
      }
      expect(problems).toEqual([]);
    });
  }
}

/**
 * Read the finished picture of a scene at one device pixel ratio. Device emulation sets the ratio, as
 * browser device modes and audit tools do. `cells` holds the share of strong paint in each cell of a
 * 4 x 4 grid over the bitmap, so pictures at two ratios compare cell by cell.
 */
async function readPicture(browser, baseURL, scene, deviceScaleFactor) {
  const context = await browser.newContext({ viewport: VIEWPORTS.desktop, deviceScaleFactor });
  const page = await context.newPage();
  await useReducedMotion(page);
  await page.goto(new URL(scene.route, baseURL).href);
  await expect(page.locator(scene.selector)).toHaveAttribute("data-motion-state", "still");
  await settle(page);
  const picture = await page.locator(`${scene.selector} canvas`).evaluate((canvas) => {
    const { width, height } = canvas;
    const { data } = canvas.getContext("2d").getImageData(0, 0, width, height);
    const cells = new Array(16).fill(0);
    let strong = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (data[(y * width + x) * 4 + 3] <= 140) continue;
        cells[Math.floor((y * 4) / height) * 4 + Math.floor((x * 4) / width)] += 1;
        strong += 1;
      }
    }
    const box = canvas.getBoundingClientRect();
    return { ratio: devicePixelRatio, bitmap: [width, height], box: [box.width, box.height], cells: cells.map((count) => count / strong) };
  });
  await context.close();
  return picture;
}

for (const [scene, deviceScaleFactor] of [[scenes[1], 2], [scenes[0], 1.5]]) {
  test(`${scene.name} draws its whole picture at a device pixel ratio of ${deviceScaleFactor}`, async ({ browser, baseURL }) => {
    const plain = await readPicture(browser, baseURL, scene, 1);
    const dense = await readPicture(browser, baseURL, scene, deviceScaleFactor);
    expect(dense.ratio).toBe(deviceScaleFactor);
    // The ratio is under the cap of each scene, so the bitmap has the CSS size times the ratio.
    expect(Math.abs(dense.bitmap[0] - dense.box[0] * deviceScaleFactor), `bitmap ${dense.bitmap} for box ${dense.box}`).toBeLessThanOrEqual(1);
    expect(Math.abs(dense.bitmap[1] - dense.box[1] * deviceScaleFactor), `bitmap ${dense.bitmap} for box ${dense.box}`).toBeLessThanOrEqual(1);
    // The same marks paint in the same cells, so little paint moves: under 0.15 of it on macOS.
    // A cropped picture moves its paint to other cells: 1.5 for the globe and 2 for About.
    const moved = dense.cells.reduce((sum, share, i) => sum + Math.abs(share - plain.cells[i]), 0);
    expect(moved, "the picture at the higher ratio is the whole picture, not a crop").toBeLessThan(0.5);
  });
}

test("resumes product drift after reduced motion ends", async ({ page }) => {
  await useManualFrames(page);
  await page.goto(`${dev}/products/`);
  await expect(page.locator("[data-graphic='products']")).toHaveAttribute("data-motion-state", "playing");
  await expect.poll(() => pendingFrames(page)).toBe(1);
  await useReducedMotion(page);
  await expect(page.locator("[data-graphic='products']")).toHaveAttribute("data-motion-state", "still");
  expect(await pendingFrames(page)).toBe(0);
  await useReducedMotion(page, "no-preference");
  await expect(page.locator("[data-graphic='products']")).toHaveAttribute("data-motion-state", "playing");
  expect(await pendingFrames(page)).toBe(1);
});

for (const failure of ["canvas", "resize", "intersection", "setup"]) {
  test(`keeps the finished globe and page content after ${failure} failure`, async ({ page }) => {
    await useManualFrames(page);
    await useLifetimeSpy(page);
    await useReducedMotion(page);
    await page.addInitScript((kind) => {
      if (kind === "canvas") HTMLCanvasElement.prototype.getContext = () => null;
      if (kind === "resize") delete window.ResizeObserver;
      if (kind === "intersection") delete window.IntersectionObserver;
      if (kind === "setup") window.__failIntersection = true;
    }, failure);
    const problems = [];
    page.on("pageerror", (error) => problems.push(error.message));
    await page.goto("/");
    const fallback = page.locator("[data-lyra-globe] .lyra-globe__fallback");
    await expect(fallback).toBeVisible();
    await expect(fallback).toHaveCount(1);
    await expect(fallback).toHaveCSS("opacity", "1");
    expect(await fallback.locator("path.is-hot").count()).toBeGreaterThanOrEqual(10);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator(".hero__lede")).toBeVisible();
    expect(await pendingFrames(page)).toBe(0);
    expect(await lifetimes(page)).toEqual(emptyLifetime);
    await transition(page, "pageshow");
    await expect(fallback).toHaveCount(1);
    await page.goto("/about/");
    await expect(page.locator("[data-graphic]")).toBeHidden();
    await expect(page.locator("h1")).toBeVisible();
    expect(await pendingFrames(page)).toBe(0);
    expect(await lifetimes(page)).toEqual(emptyLifetime);
    expect(problems).toEqual([]);
  });
}

test("cleans a failed restore and keeps one finished SVG", async ({ page }) => {
  await useManualFrames(page);
  await useLifetimeSpy(page);
  await page.goto("/");
  await expect(page.locator("[data-lyra-globe]")).toHaveAttribute("data-ready", "true");
  await expect.poll(() => pendingFrames(page)).toBe(1);
  await transition(page, "pagehide");
  await page.evaluate(() => { window.__failIntersection = true; });
  await transition(page, "pageshow");
  await expect(page.locator("[data-lyra-globe] .lyra-globe__fallback")).toHaveCount(1);
  await expect(page.locator("[data-lyra-globe] .lyra-globe__fallback")).toBeVisible();
  expect(await lifetimes(page)).toEqual(emptyLifetime);
  expect(await pendingFrames(page)).toBe(0);
  await transition(page, "pageshow");
  await expect(page.locator("[data-lyra-globe] .lyra-globe__fallback")).toHaveCount(1);
  await expect(page.locator("[data-lyra-globe]")).not.toHaveAttribute("data-ready", /.*/);
  await expect(page.locator("h1")).toBeVisible();
});
