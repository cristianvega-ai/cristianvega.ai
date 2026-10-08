import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { CROP_ABOVE_RING, CROP_BELOW_CAPTION, PICTURE_SCALE } from "../../src/shared/lyra-globe/projection.ts";
import { createIsolatedBuild } from "../helpers.mjs";
import { pageProblems, settle, useManualFrames, useReducedMotion, VIEWPORTS, pendingFrames, playFrames } from "./fixtures.mjs";

const globe = "[data-lyra-globe]";
const labels = `${globe} .lyra-globe__label`;
const problems = new WeakMap();
const opacity = (page) => page.locator(labels).evaluateAll((nodes) => nodes.map((node) => Number(getComputedStyle(node).opacity)));
const transition = (page, type) => page.evaluate((name) => {
  window.dispatchEvent(new PageTransitionEvent(name, { persisted: true }));
}, type);

test.use({ viewport: VIEWPORTS.desktop });

test.beforeEach(async ({ page }) => {
  problems.set(page, pageProblems(page));
});

test.afterEach(async ({ page }) => {
  expect(problems.get(page), "the browser must report no console or CSP errors").toEqual([]);
});

async function finishLabels(page) {
  await expect(page.locator(globe)).toHaveAttribute("data-motion-state", "still");
  expect(await opacity(page)).toEqual([0.9, 0.7]);
  await expect.poll(() => page.locator(labels).evaluateAll((nodes) => nodes.flatMap((node) => node.getAnimations()).length)).toBe(0);
  await settle(page);
  expect(await page.locator(`${globe} [style]`).count()).toBe(0);
}

for (const pause of ["hidden", "offscreen"]) {
  test(`keeps label progress while the globe is ${pause}`, async ({ page }) => {
    await useManualFrames(page);
    await useReducedMotion(page, "no-preference");
    await page.goto("/");
    await expect(page.locator(globe)).toHaveAttribute("data-ready", "true");
    await expect.poll(() => pendingFrames(page)).toBe(1);
    // The first frame starts the clock. Each frame then adds 16 ms, under the 64 ms cap.
    await playFrames(page, 800);
    await expect.poll(async () => (await opacity(page))[1]).toBeGreaterThan(0);
    const first = await opacity(page);
    expect(first[0]).toBe(0);
    expect(first[1]).toBeGreaterThan(0);
    expect(first[1]).toBeLessThan(0.7);

    const pauseTime = await page.evaluate((kind) => {
      if (kind === "hidden") {
        Object.defineProperty(document, "hidden", { configurable: true, value: true });
        document.dispatchEvent(new Event("visibilitychange"));
      } else {
        const spacer = document.createElement("div");
        for (let i = 0; i < 180; i++) spacer.append(document.createElement("br"));
        document.querySelector("#main-content").after(spacer);
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
      }
      return document.timeline.currentTime;
    }, pause);
    await expect.poll(() => pendingFrames(page)).toBe(0);
    const image = await page.locator(`${globe} canvas`).evaluate((canvas) => canvas.toDataURL());
    // Let the browser's animation clock pass the old label entrance.
    await expect.poll(() => page.evaluate((start) => document.timeline.currentTime - start, pauseTime), { timeout: 5000 }).toBeGreaterThan(2400);
    expect(await opacity(page)).toEqual(first);
    expect(await page.locator(`${globe} canvas`).evaluate((canvas) => canvas.toDataURL())).toBe(image);
    await expect(page.locator(globe)).toHaveAttribute("data-motion-state", "playing");

    await page.evaluate((kind) => {
      if (kind === "hidden") {
        Object.defineProperty(document, "hidden", { configurable: true, value: false });
        document.dispatchEvent(new Event("visibilitychange"));
      } else window.scrollTo({ top: 0, behavior: "instant" });
    }, pause);
    await expect.poll(() => pendingFrames(page)).toBe(1);
    // The first frame after the pause adds no time.
    await playFrames(page, 16);
    expect(await opacity(page)).toEqual(first);
    await playFrames(page, 512);
    expect(await opacity(page)).toEqual([0, 0.7]);
    await playFrames(page, 1100);
    await finishLabels(page);
    expect(await pendingFrames(page)).toBe(0);
  });
}

test("shows complete labels for reduced motion and live preference changes", async ({ page }) => {
  await useManualFrames(page);
  await useReducedMotion(page);
  await page.goto("/");
  await finishLabels(page);
  expect(await pendingFrames(page)).toBe(0);
  await useReducedMotion(page, "no-preference");
  await finishLabels(page);
  await transition(page, "pagehide");
  await transition(page, "pageshow");
  await expect(page.locator(globe)).toHaveAttribute("data-ready", "true");
  await expect.poll(() => pendingFrames(page)).toBe(1);
  expect(await opacity(page)).toEqual([0, 0]);
  await playFrames(page, 816);
  await useReducedMotion(page);
  await finishLabels(page);
  expect(await pendingFrames(page)).toBe(0);
});

test("restarts label progress after each restored entrance", async ({ page }) => {
  await useManualFrames(page);
  await useReducedMotion(page, "no-preference");
  await page.goto("/");
  for (let cycle = 0; cycle < 3; cycle++) {
    await expect(page.locator(globe)).toHaveAttribute("data-ready", "true");
    await expect.poll(() => pendingFrames(page)).toBe(1);
    expect(await opacity(page)).toEqual([0, 0]);
    expect(await page.locator(labels).evaluateAll((nodes) => nodes.flatMap((node) => node.getAnimations()).length)).toBe(2);
    await playFrames(page, 2400);
    await finishLabels(page);
    await transition(page, "pagehide");
    await expect(page.locator(globe)).not.toHaveAttribute("data-ready", /.*/);
    expect(await pendingFrames(page)).toBe(0);
    await transition(page, "pageshow");
  }
});

test("shows complete fallback labels after a restored canvas fails", async ({ page }) => {
  await useManualFrames(page);
  await page.addInitScript(() => {
    const Observer = window.ResizeObserver;
    window.ResizeObserver = class extends Observer {
      constructor(callback) {
        if (window.__failResize) throw new Error("Resize setup failed");
        super(callback);
      }
    };
  });
  await page.goto("/");
  await expect(page.locator(globe)).toHaveAttribute("data-ready", "true");
  await playFrames(page, 816);
  await transition(page, "pagehide");
  await page.evaluate(() => { window.__failResize = true; });
  await transition(page, "pageshow");
  await expect(page.locator(`${globe} .lyra-globe__fallback`)).toBeVisible();
  await expect(page.locator(`${globe} .lyra-globe__labels`)).toHaveCSS("opacity", "1");
  expect(await opacity(page)).toEqual([0.9, 0.7]);
  expect(await page.locator(labels).evaluateAll((nodes) => nodes.flatMap((node) => node.getAnimations()).length)).toBe(0);
  expect(await pendingFrames(page)).toBe(0);
});

test("loads the projection stylesheet from the head with a long cache", async ({ page, request }) => {
  await page.goto("/");
  const links = await page.evaluate(() => ({
    head: [...document.head.querySelectorAll('link[rel="stylesheet"][href^="/globe-projection/"]')].map((link) => link.getAttribute("href")),
    body: document.body.querySelectorAll('link[href^="/globe-projection/"]').length,
  }));
  expect(links.head).toHaveLength(1);
  expect(links.body, "the body must not hold a stylesheet that blocks the parser").toBe(0);
  expect(links.head[0]).toMatch(/^\/globe-projection\/[a-f0-9]{16}\.css$/);
  const response = await request.get(links.head[0]);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/css");
  expect(response.headers()["cache-control"], "the versioned URL can stay cached").toBe("public, max-age=31536000, immutable");
});

test("sizes the globe labels with the graphic label token", async ({ page }) => {
  // The band box is narrower than 460px, so the labels keep the graphic label size.
  await page.setViewportSize(VIEWPORTS.mobile);
  await page.goto("/");
  await expect(page.locator(globe)).toHaveAttribute("data-ready", "true");
  const size = () => page.locator(`${labels}:not(.lyra-globe__label--caption)`).evaluate((label) => getComputedStyle(label).fontSize);
  expect(await size()).toBe(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--fs-graphic-label").trim()));
  await page.evaluate(() => document.documentElement.style.setProperty("--fs-graphic-label", "13px"));
  expect(await size()).toBe("13px");
});

/** Read the globe boxes in page pixels. */
const globeBoxes = (page) => page.evaluate(() => Object.fromEntries([".hero__globe", ".lyra-globe", ".lyra-globe__canvas"].map((selector) => {
  const { left, top, width, height } = document.querySelector(selector).getBoundingClientRect();
  return [selector, { left, top, width, height }];
})));

for (const viewport of [VIEWPORTS.desktop, { width: 1100, height: 800 }, VIEWPORTS.tablet, VIEWPORTS.mobile]) {
  test(`keeps the globe size when the projection stylesheet fails at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await useReducedMotion(page);
    await page.goto("/");
    await expect(page.locator(globe)).toHaveAttribute("data-ready", "true");
    await settle(page);
    const loaded = await globeBoxes(page);

    const failed = [];
    page.on("console", (message) => {
      if (message.type() === "error" && message.location().url.includes("/globe-projection/")) failed.push(message.text());
    });
    await page.route("**/globe-projection/**", (route) => route.abort());
    await page.goto("/");
    await expect(page.locator(globe)).toHaveAttribute("data-ready", "true");
    await settle(page);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector(".hero__globe")).getPropertyValue("--globe-box-aspect"))).toBe("");
    const fallback = await globeBoxes(page);
    // The fallbacks in home.css hold the measurements of the current model.
    for (const [selector, box] of Object.entries(loaded)) {
      expect(box.width, `${selector} has a width`).toBeGreaterThan(100);
      expect(box.height, `${selector} has a height`).toBeGreaterThan(100);
      for (const side of ["left", "top", "width", "height"]) {
        expect(Math.abs(fallback[selector][side] - box[side]), `${selector} ${side} without the projection stylesheet`).toBeLessThanOrEqual(1);
      }
    }
    // The --globe-caption-length fallback gives the caption reach of the model caption.
    const read = await readProjection(page);
    const captionReach = read.captionLength * 0.5 * read.ch + 2;
    expect(Math.abs(read.captionReach - captionReach), `caption reach ${read.captionReach} without the projection stylesheet`).toBeLessThanOrEqual(1);
    // The backdrop shows from 1100px. The --globe-center-top fallback keeps it on the sphere centre.
    if (viewport.width >= 1100) {
      for (const axis of ["x", "y"]) {
        expect(Math.abs(read.underlay[axis] - read.sphere[axis]), `backdrop ${axis} without the projection stylesheet`).toBeLessThanOrEqual(1);
      }
    }
    await expect(page.locator("h1")).toBeVisible();
    // The browser reports the aborted stylesheet. That error is expected here.
    expect(failed.length).toBeGreaterThan(0);
    problems.set(page, problems.get(page).filter((problem) => !failed.includes(problem)));
  });
}

for (const viewport of [{ width: 1100, height: 800 }, VIEWPORTS.desktop, { width: 1920, height: 1080 }]) {
  test(`centres the backdrop on the sphere at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await useReducedMotion(page);
    await page.goto("/");
    await expect(page.locator(globe)).toHaveAttribute("data-ready", "true");
    await settle(page);
    const read = await readProjection(page);
    expect(Math.abs(read.underlay.x - read.sphere.x), `x: backdrop ${read.underlay.x}, sphere ${read.sphere.x}`).toBeLessThanOrEqual(1);
    expect(Math.abs(read.underlay.y - read.sphere.y), `y: backdrop ${read.underlay.y}, sphere ${read.sphere.y}`).toBeLessThanOrEqual(1);
  });
}

/** Change model inputs in an isolated build. Keep the production source intact. */
const createGlobeBuild = () => createIsolatedBuild({
  prefix: "cristianai-globe-",
  edits: {
    "src/shared/lyra-globe/model.ts": [
      ["GLOBE_WIDTH = 600", "GLOBE_WIDTH = 720"],
      ["GLOBE_HEIGHT = 500", "GLOBE_HEIGHT = 560"],
      ["width * 0.51", "width * 0.54"],
      ["height * 0.49", "height * 0.46"],
      ["Math.min(width, height) * 0.34", "Math.min(width, height) * 0.29"],
      ["VEGA_OFFSET_X = 0.12", "VEGA_OFFSET_X = 0.16"],
      ["radius * 1.13", "radius * 1.2"],
      ['"LYRA / NEURAL SPHERE"', '"LYRA / NEURAL SPHERE / MODEL"'],
    ],
  },
});

async function readProjection(page) {
  return page.evaluate(() => {
    const host = document.querySelector(".hero__globe");
    const hostBox = host.getBoundingClientRect();
    const style = getComputedStyle(host);
    const canvas = document.querySelector(".lyra-globe__canvas").getBoundingClientRect();
    const svg = document.querySelector("[data-lyra-globe] template").content.querySelector("svg");
    const ring = [...svg.querySelectorAll("ellipse")].sort((a, b) => b.rx.baseVal.value * b.ry.baseVal.value - a.rx.baseVal.value * a.ry.baseVal.value)[0];
    const vega = svg.querySelector('circle.is-hot[r="4.1"]');
    const caption = document.querySelector("[data-lyra-globe] .lyra-globe__label--caption");
    // 1ch is the advance of one character in the font of the host. A long probe averages out layout rounding.
    const probe = document.createElement("div");
    probe.style.width = "1000ch";
    host.append(probe);
    const ch = probe.getBoundingClientRect().width / 1000;
    probe.remove();
    // The caption reach that home.css computes from --globe-caption-length. A new probe has no
    // earlier width, so the short reduced-motion transition cannot delay the reading.
    const reachProbe = document.createElement("div");
    reachProbe.style.width = "var(--globe-caption-reach)";
    host.append(reachProbe);
    const captionReach = reachProbe.getBoundingClientRect().width;
    reachProbe.remove();
    return {
      width: svg.viewBox.baseVal.width,
      height: svg.viewBox.baseVal.height,
      cx: ring.cx.baseVal.value,
      cy: ring.cy.baseVal.value,
      radius: ring.rx.baseVal.value,
      vegaY: vega.cy.baseVal.value,
      // The caption y is a share of the picture height, in percent.
      captionY: (parseFloat(caption.getAttribute("y")) / 100) * svg.viewBox.baseVal.height,
      captionLength: caption.textContent.length,
      ch,
      captionReach,
      inset: parseFloat(style.getPropertyValue("--figure-inset")),
      limits: {
        max: parseFloat(style.getPropertyValue("--globe-max")),
        size: parseFloat(style.getPropertyValue("--frame")) * 0.55 - 5,
        height: innerHeight - ["--header-height", "--head-top", "--footer-reserve"].reduce((sum, name) => sum + parseFloat(style.getPropertyValue(name)), 0)
          - 2 * parseFloat(style.getPropertyValue("--globe-gap")),
        room: innerWidth - hostBox.left,
        fade: parseFloat(style.getPropertyValue("--fade")),
      },
      host: { width: hostBox.width, height: hostBox.height },
      canvas: { x: canvas.left - hostBox.left, y: canvas.top - hostBox.top, width: canvas.width, height: canvas.height },
      // The sphere centre in host pixels, from the drawn picture and the model ring.
      sphere: {
        x: canvas.left - hostBox.left + (ring.cx.baseVal.value / svg.viewBox.baseVal.width) * canvas.width,
        y: canvas.top - hostBox.top + (ring.cy.baseVal.value / svg.viewBox.baseVal.height) * canvas.height,
      },
      // The centre of the backdrop box after its transform, in host pixels.
      underlay: (() => {
        const layer = getComputedStyle(host, "::before");
        const shift = new DOMMatrixReadOnly(layer.transform === "none" ? undefined : layer.transform);
        return {
          x: parseFloat(layer.left) + parseFloat(layer.width) / 2 + shift.e,
          y: parseFloat(layer.top) + parseFloat(layer.height) / 2 + shift.f,
        };
      })(),
      href: document.querySelector('link[href^="/globe-projection/"]').getAttribute("href"),
    };
  });
}

test("updates served globe geometry when the model changes", async ({ page }) => {
  test.setTimeout(90000);
  await useReducedMotion(page);
  const response = await page.goto("/");
  await expect(page.locator(globe)).toHaveAttribute("data-ready", "true");
  await settle(page);
  const original = await readProjection(page);
  const headers = response.headers();
  const policy = Object.fromEntries(Object.entries(headers).filter(([name]) => ["content-security-policy", "x-content-type-options"].includes(name)));
  expect(policy["content-security-policy"]).toContain("style-src 'self'");
  expect(policy["content-security-policy"]).toContain("style-src-attr 'none'");
  const fixture = await createGlobeBuild();
  const origin = new URL(page.url()).origin;
  const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".woff2": "font/woff2" };
  try {
    await page.route(`${origin}/**`, async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      const file = join(fixture.dist, pathname === "/" ? "index.html" : pathname);
      try {
        await route.fulfill({ body: await readFile(file), headers: { ...policy, "content-type": types[extname(file)] ?? "application/octet-stream" } });
      } catch { await route.continue(); }
    });
    const round = (value) => Math.round(value * 10000) / 10000;
    for (const viewport of [VIEWPORTS.desktop, { width: 1100, height: 800 }, VIEWPORTS.tablet, VIEWPORTS.mobile,
      { width: 1920, height: 1080 }, { width: 360, height: 740 }]) {
      await page.setViewportSize(viewport);
      await page.goto("/");
      await expect(page.locator(globe)).toHaveAttribute("data-ready", "true");
      await settle(page);
      const read = await readProjection(page);
      expect(read.width).toBe(720);
      expect(read.height).toBe(560);
      // SVG lengths use single precision.
      expect(read.cx / read.width).toBeCloseTo(0.54, 6);
      expect(read.cy / read.height).toBeCloseTo(0.46, 6);
      expect(read.href).not.toBe(original.href);
      const aspect = round(read.height / read.width);
      if (viewport.width >= 1100) {
        // The crop runs from just above the outer ring to just below the caption anchor.
        const cropTop = read.cy - read.radius * (1 + CROP_ABOVE_RING);
        const cropBottom = read.captionY + read.radius * CROP_BELOW_CAPTION;
        const pictureHeight = round(read.height / (cropBottom - cropTop));
        const pictureTop = round(-cropTop / (cropBottom - cropTop));
        const ringInset = round((read.cx - read.radius) / read.width * PICTURE_SCALE);
        const boxAspect = round(aspect * PICTURE_SCALE / pictureHeight);
        const centerReach = round(read.radius / read.width * PICTURE_SCALE);
        // The caption is centred on the sphere. It reaches half its length past the centre, plus 2px of slack.
        const captionReach = read.captionLength * 0.5 * read.ch + 2;
        const expectedWidth = Math.min(read.limits.max, read.limits.size, Math.max(260, read.limits.height / boxAspect),
          (read.limits.room - read.inset - captionReach - read.limits.fade) / centerReach);
        expect(Math.abs(read.host.width - expectedWidth)).toBeLessThan(0.03);
        expect(Math.abs(read.canvas.x - (read.inset - ringInset * read.host.width))).toBeLessThan(0.03);
        expect(Math.abs(read.canvas.y - pictureTop * read.host.height)).toBeLessThan(0.03);
        expect(Math.abs(read.canvas.height - pictureHeight * read.host.height)).toBeLessThan(0.03);
        expect(Math.abs(read.host.height - read.host.width * boxAspect)).toBeLessThan(0.03);
        // The box shows the whole outer ring and the caption anchor, with a small margin.
        const unit = read.canvas.height / read.height;
        const ringTop = read.canvas.y + (read.cy - read.radius) * unit;
        const captionBase = read.canvas.y + read.captionY * unit;
        expect(ringTop).toBeGreaterThan(0);
        expect(ringTop).toBeLessThan(read.radius * 0.06 * unit);
        expect(captionBase).toBeLessThan(read.host.height);
        expect(read.host.height - captionBase).toBeLessThan(read.radius * 0.06 * unit);
        expect(Math.abs(read.underlay.x - read.sphere.x), "the backdrop sits on the sphere centre").toBeLessThanOrEqual(1);
        expect(Math.abs(read.underlay.y - read.sphere.y), "the backdrop sits on the sphere centre").toBeLessThanOrEqual(1);
      } else {
        expect(Math.abs(read.canvas.x - (read.host.width / 2 - read.canvas.width * read.cx / read.width))).toBeLessThan(0.03);
        expect(Math.abs(read.canvas.y - (read.host.height * 0.486 - read.canvas.width * read.vegaY / read.width))).toBeLessThan(0.03);
        expect(Math.abs(read.canvas.height - read.canvas.width * aspect)).toBeLessThan(0.03);
      }
      expect(await page.locator("style, [style]").count()).toBe(0);
    }
  } finally { await fixture.cleanup(); }
});
