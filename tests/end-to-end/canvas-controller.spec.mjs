import { expect, test } from "@playwright/test";

import { DRAFT_ORIGIN as draftOrigin, settle, VIEWPORTS as viewports, useManualFrames, useReducedMotion, pendingFrames, stepFrame } from "../shared/browser-fixtures.mjs";

const readResourceCounts = (page) => page.evaluate(() => window.__lifetimes());
const readControllerClock = (page) => page.evaluate(() => {
  const { elapsed, activeTime, reduced, ratio: pixelRatio } = window.__handle.state;
  return { elapsed, activeTime, reduced, ratio: pixelRatio };
});

/** Count live observers and controller listeners. Keep native observer delivery. */
async function useLifetimeSpy(page) {
  await page.addInitScript(() => {
    const activeObservers = { resize: new Set(), intersection: new Set() };
    const controllerListeners = new Map(["visibilitychange", "pagehide", "pageshow", "preference"].map((entryName) => [entryName, new Set()]));
    window.__observers = { resize: [], intersection: [] };
    for (const [observerKind, observerClassName] of [["resize", "ResizeObserver"], ["intersection", "IntersectionObserver"]]) {
      const nativeObserver = window[observerClassName];
      window[observerClassName] = class extends nativeObserver {
        constructor(observerCallback) {
          super(observerCallback);
          window.__observers[observerKind].push({ observer: this, callback: observerCallback });
        }
        observe(...observationArguments) {
          super.observe(...observationArguments);
          activeObservers[observerKind].add(this);
          if (observerKind === "intersection" && window.__failIntersection) throw new Error("Observe failed");
        }
        disconnect() {
          super.disconnect();
          activeObservers[observerKind].delete(this);
        }
      };
    }
    const originalAddEventListener = EventTarget.prototype.addEventListener;
    const originalRemoveEventListener = EventTarget.prototype.removeEventListener;
    const listenerKey = (target, eventType) => {
      if (target === document && eventType === "visibilitychange") return eventType;
      if (target === window && (eventType === "pagehide" || eventType === "pageshow")) return eventType;
      if (target instanceof MediaQueryList && eventType === "change" && target.media.includes("prefers-reduced-motion")) return "preference";
    };
    EventTarget.prototype.addEventListener = function (eventType, listener, listenerOptions) {
      const entryName = listenerKey(this, eventType);
      if (entryName) controllerListeners.get(entryName).add(listener);
      return originalAddEventListener.call(this, eventType, listener, listenerOptions);
    };
    EventTarget.prototype.removeEventListener = function (eventType, listener, listenerOptions) {
      const entryName = listenerKey(this, eventType);
      if (entryName) controllerListeners.get(entryName).delete(listener);
      return originalRemoveEventListener.call(this, eventType, listener, listenerOptions);
    };
    window.__lifetimes = () => ({
      resize: activeObservers.resize.size,
      intersection: activeObservers.intersection.size,
      ...Object.fromEntries([...controllerListeners].map(([entryName, registeredListeners]) => [entryName, registeredListeners.size])),
    });
  });
}

/** Mount a small scene through the real controller. Read its public handle. */
async function mountScene(page, canvasPolicy, { duration: entranceDuration = 2300, busy: sceneBusy = false, count: sceneCount = 1 } = {}) {
  await useManualFrames(page);
  await useLifetimeSpy(page);
  const sceneAddress = `${draftOrigin}/__canvas-controller__/`;
  await page.route(sceneAddress, (route) => route.fulfill({
    contentType: "text/html",
    body: "<!doctype html><html><head><title>Canvas controller test</title></head><body></body></html>",
  }));
  await page.goto(sceneAddress);
  await page.evaluate(async (sceneSettings) => {
    const { mountCanvas } = await import("/src/shared/page-graphics/mount.ts");
    const { GLOBE_POLICY: globePolicy, mountCanvasController } = await import("/src/shared/motion/canvas-controller.ts");
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, get: () => 3 });
    window.__busy = sceneSettings.busy;
    window.__draws = 0;
    window.__builds = 0;
    window.__attached = 0;
    window.__detached = 0;
    window.__handles = [];
    window.__stateChanged = false;
    for (let sceneIndex = 0; sceneIndex < sceneSettings.count; sceneIndex += 1) {
      const sceneRoot = document.createElement("div");
      sceneRoot.dataset.scene = String(sceneIndex);
      sceneRoot.style.cssText = "width:240px;height:160px;margin:24px";
      sceneRoot.append(document.createElement("canvas"));
      sceneRoot.firstElementChild.style.cssText = "display:block;width:100%;height:100%";
      document.body.append(sceneRoot);
      let initialDrawState;
      const canvasOptions = {
        duration: sceneSettings.duration,
        onResize() {
          window.__builds += 1;
        },
        draw(drawingContext, drawState) {
          if (initialDrawState && initialDrawState !== drawState) window.__stateChanged = true;
          initialDrawState = drawState;
          window.__draws += 1;
          drawingContext.drawImage(drawState.glow, 10, 10);
          drawingContext.fillRect(0, 0, drawState.progress * drawState.width, 1);
          return window.__busy && !drawState.reduced;
        },
        attach(controllerHandle) {
          window.__attached += 1;
          const wakeScene = () => controllerHandle.wake();
          window.addEventListener("scenechange", wakeScene);
          return () => {
            window.__detached += 1;
            window.removeEventListener("scenechange", wakeScene);
          };
        },
      };
      const controllerHandle = sceneSettings.policy === "page"
        ? mountCanvas(sceneRoot, canvasOptions)
        : mountCanvasController(sceneRoot, canvasOptions, globePolicy);
      window.__handles.push(controllerHandle);
    }
    window.__handle = window.__handles[0];
    const scrollSpacer = document.createElement("div");
    scrollSpacer.style.height = "3000px";
    document.body.append(scrollSpacer);
  }, { policy: canvasPolicy, duration: entranceDuration, busy: sceneBusy, count: sceneCount });
  await expect(page.locator("[data-scene][data-ready='true']")).toHaveCount(sceneCount);
  await expect.poll(() => pendingFrames(page)).toBe(sceneCount);
}

const setDocumentHidden = (page, documentHidden) => page.evaluate((hiddenValue) => {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hiddenValue });
  document.dispatchEvent(new Event("visibilitychange"));
}, documentHidden);
const dispatchPageTransition = (page, transitionType, persisted = true) => page.evaluate(([transitionType, isPersisted]) => {
  window.dispatchEvent(new PageTransitionEvent(transitionType, { persisted: isPersisted }));
}, [transitionType, persisted]);
const activeResourceCounts = { resize: 1, intersection: 1, visibilitychange: 1, pagehide: 1, pageshow: 1, preference: 1 };
const pausedResourceCounts = { ...activeResourceCounts, resize: 0, intersection: 0, visibilitychange: 0, preference: 0 };
const emptyResourceCounts = { resize: 0, intersection: 0, visibilitychange: 0, pagehide: 0, pageshow: 0, preference: 0 };

for (const canvasPolicy of ["page", "globe"]) {
  test.describe(`${canvasPolicy} canvas controller`, () => {
    test("The canvas controller caps long frame intervals and preserves its pixel ratio policy", async ({ page }) => {
      await mountScene(page, canvasPolicy);
      await page.evaluate(() => { window.__step(0); window.__step(1000); });
      // Every canvas caps the frame interval at 64 ms.
      expect(await readControllerClock(page)).toEqual({
        elapsed: 64,
        activeTime: 64,
        reduced: false,
        ratio: canvasPolicy === "page" ? 2 : 1.75,
      });
      expect(await page.evaluate(() => window.__stateChanged)).toBe(false);
      await expect(page.locator("[data-scene] canvas")).toHaveAttribute("width", canvasPolicy === "page" ? "480" : "420");
    });

    test("The canvas controller excludes hidden and offscreen time from both clocks", async ({ page }) => {
      await mountScene(page, canvasPolicy);
      await page.evaluate(() => { window.__step(0); window.__step(32); });
      await setDocumentHidden(page, true);
      expect(await pendingFrames(page)).toBe(0);
      await page.evaluate(() => window.__step(20000));
      expect((await readControllerClock(page)).activeTime).toBe(32);
      await setDocumentHidden(page, false);
      expect(await pendingFrames(page)).toBe(1);
      await page.evaluate(() => window.__step(30000));
      expect((await readControllerClock(page)).activeTime).toBe(32);
      await page.evaluate(() => window.__step(30016));
      expect((await readControllerClock(page)).activeTime).toBe(48);
      await page.evaluate(() => scrollTo(0, 2000));
      await expect.poll(() => pendingFrames(page)).toBe(0);
      await page.evaluate(() => window.__step(40000));
      expect((await readControllerClock(page)).elapsed).toBe(48);
      await page.evaluate(() => scrollTo(0, 0));
      await expect.poll(() => pendingFrames(page)).toBe(1);
      await page.evaluate(() => window.__step(50000));
      expect((await readControllerClock(page)).elapsed).toBe(48);
      await page.evaluate(() => window.__step(50016));
      expect((await readControllerClock(page)).elapsed).toBe(64);
    });

    test("The canvas controller restores resources and ignores callbacks from previous observers", async ({ page }) => {
      await mountScene(page, canvasPolicy);
      await page.evaluate(() => { window.__step(0); window.__step(32); });
      for (let restoreCycle = 1; restoreCycle <= 3; restoreCycle += 1) {
        const savedClock = await readControllerClock(page);
        await dispatchPageTransition(page, "pagehide");
        expect(await readResourceCounts(page)).toEqual(pausedResourceCounts);
        expect(await pendingFrames(page)).toBe(0);
        await expect(page.locator("[data-scene]")).not.toHaveAttribute("data-ready", /.*/);
        await dispatchPageTransition(page, "pageshow", false);
        expect(await readResourceCounts(page)).toEqual(pausedResourceCounts);
        await dispatchPageTransition(page, "pageshow");
        await expect(page.locator("[data-scene]")).toHaveAttribute("data-ready", "true");
        await expect.poll(() => pendingFrames(page)).toBe(1);
        await dispatchPageTransition(page, "pageshow");
        expect(await readResourceCounts(page)).toEqual(activeResourceCounts);
        expect(await page.evaluate(() => window.__attached)).toBe(restoreCycle + 1);
        expect(await page.evaluate(() => window.__detached)).toBe(restoreCycle);
        const restoredClock = canvasPolicy === "page" ? savedClock : { ...savedClock, elapsed: 0, activeTime: 0 };
        expect(await readControllerClock(page)).toEqual(restoredClock);
        const drawCount = await page.evaluate(() => window.__draws);
        await page.evaluate((previousObserverIndex) => {
          window.__observers.resize[previousObserverIndex].callback([{ contentRect: { width: 1, height: 1 } }]);
          window.__observers.intersection[previousObserverIndex].callback([{ isIntersecting: false }]);
        }, restoreCycle - 1);
        expect(await page.evaluate(() => window.__draws)).toBe(drawCount);
        expect(await pendingFrames(page)).toBe(1);
        await stepFrame(page, restoreCycle * 10000);
        expect(await readControllerClock(page)).toEqual(restoredClock);
        await page.evaluate((time) => window.__step(time + 16), restoreCycle * 10000);
      }
      const drawCount = await page.evaluate(() => window.__draws);
      await page.evaluate(() => {
        window.__handle.destroy();
        window.__handle.destroy();
        window.__handle.wake();
        window.__handle.redraw();
        window.__handle.replay();
      });
      await dispatchPageTransition(page, "pageshow");
      expect(await readResourceCounts(page)).toEqual(emptyResourceCounts);
      expect(await pendingFrames(page)).toBe(0);
      expect(await page.evaluate(() => window.__draws)).toBe(drawCount);
      expect(await page.evaluate(() => window.__detached)).toBe(4);
      await expect(page.locator("[data-scene]")).not.toHaveAttribute("data-ready", /.*/);
    });

    test("The canvas controller applies reduced motion changes in both directions", async ({ page }) => {
      await mountScene(page, canvasPolicy, { busy: true });
      await page.evaluate(() => { window.__step(0); window.__step(32); });
      for (let preferenceCycle = 0; preferenceCycle < 2; preferenceCycle += 1) {
        await useReducedMotion(page);
        await expect(page.locator("[data-scene]")).toHaveAttribute("data-motion-state", "still");
        expect(await pendingFrames(page)).toBe(0);
        expect(await readControllerClock(page)).toEqual({ elapsed: 2300, activeTime: 0, reduced: true, ratio: canvasPolicy === "page" ? 2 : 1.75 });
        await useReducedMotion(page, "no-preference");
        await expect(page.locator("[data-scene]")).toHaveAttribute("data-motion-state", "playing");
        expect(await pendingFrames(page)).toBe(1);
        expect((await readControllerClock(page)).reduced).toBe(false);
        await page.evaluate(() => { window.__step(90000); window.__step(90016); });
        expect((await readControllerClock(page)).activeTime).toBe(16);
        expect(await readResourceCounts(page)).toEqual(activeResourceCounts);
      }
    });

    test("An idle canvas scene resumes drawing without adding idle time", async ({ page }) => {
      await mountScene(page, canvasPolicy, { duration: 32 });
      await page.evaluate(() => { window.__step(0); window.__step(16); window.__step(32); });
      expect(await pendingFrames(page)).toBe(0);
      await expect(page.locator("[data-scene]")).toHaveAttribute("data-motion-state", "still");
      const savedClock = await readControllerClock(page);
      const drawCount = await page.evaluate(() => window.__draws);
      await page.evaluate(() => window.dispatchEvent(new Event("scenechange")));
      expect(await pendingFrames(page)).toBe(1);
      await page.evaluate(() => window.__step(90000));
      expect(await readControllerClock(page)).toEqual(savedClock);
      expect(await page.evaluate(() => window.__draws)).toBe(drawCount + 1);
      expect(await pendingFrames(page)).toBe(0);
    });
  });
}

/** Defer reduced motion events until the test releases them. */
async function useDeferredPreference(page) {
  await page.addInitScript(() => {
    const originalAddEventListener = MediaQueryList.prototype.addEventListener;
    const originalRemoveEventListener = MediaQueryList.prototype.removeEventListener;
    const listenerWrappers = new WeakMap();
    window.__preferenceJobs = [];
    MediaQueryList.prototype.addEventListener = function (eventType, listener, listenerOptions) {
      if (eventType !== "change" || !this.media.includes("prefers-reduced-motion")) return originalAddEventListener.call(this, eventType, listener, listenerOptions);
      const deferredListener = (event) => window.__preferenceJobs.push(() => listener.call(this, event));
      listenerWrappers.set(listener, deferredListener);
      return originalAddEventListener.call(this, eventType, deferredListener, listenerOptions);
    };
    MediaQueryList.prototype.removeEventListener = function (eventType, listener, listenerOptions) {
      return originalRemoveEventListener.call(this, eventType, listenerWrappers.get(listener) ?? listener, listenerOptions);
    };
  });
}

for (const canvasPolicy of ["page", "globe"]) {
  test(`${canvasPolicy} canvas rebuild applies a pending motion preference before drawing`, async ({ page }) => {
    await useDeferredPreference(page);
    await mountScene(page, canvasPolicy, { busy: true });
    const sceneLocator = page.locator("[data-scene]");
    const pixelRatio = canvasPolicy === "page" ? 2 : 1.75;
    await page.evaluate(() => { window.__step(0); window.__step(32); });
    const buildCount = await page.evaluate(() => window.__builds);

    // Rebuild the scene before the deferred preference event runs.
    await useReducedMotion(page);
    await expect.poll(() => page.evaluate(() => window.__preferenceJobs.length)).toBe(1);
    expect((await readControllerClock(page)).reduced).toBe(false);
    await page.evaluate(() => window.__handle.rebuild());
    expect(await page.evaluate(() => window.__builds)).toBe(buildCount + 1);
    expect(await readControllerClock(page)).toEqual({ elapsed: 2300, activeTime: 0, reduced: true, ratio: pixelRatio });
    await expect(sceneLocator).toHaveAttribute("data-motion-state", "still");
    expect(await pendingFrames(page)).toBe(0);
    // The deferred event must preserve the applied preference.
    await page.evaluate(() => window.__preferenceJobs.shift()());
    expect(await readControllerClock(page)).toEqual({ elapsed: 2300, activeTime: 0, reduced: true, ratio: pixelRatio });
    await expect(sceneLocator).toHaveAttribute("data-motion-state", "still");
    expect(await pendingFrames(page)).toBe(0);

    // Apply the same event order when motion resumes.
    await useReducedMotion(page, "no-preference");
    await expect.poll(() => page.evaluate(() => window.__preferenceJobs.length)).toBe(1);
    await page.evaluate(() => window.__handle.rebuild());
    expect((await readControllerClock(page)).reduced).toBe(false);
    await expect(sceneLocator).toHaveAttribute("data-motion-state", "playing");
    expect(await pendingFrames(page)).toBe(1);
    await page.evaluate(() => window.__preferenceJobs.shift()());
    expect(await pendingFrames(page)).toBe(1);

    // A rebuild after teardown must leave drawing and build counts unchanged.
    await dispatchPageTransition(page, "pagehide");
    const drawCount = await page.evaluate(() => window.__draws);
    await page.evaluate(() => window.__handle.rebuild());
    expect(await page.evaluate(() => [window.__draws, window.__builds])).toEqual([drawCount, buildCount + 2]);
    expect(await pendingFrames(page)).toBe(0);
  });
}

const sceneTargets = [
  { name: "globe", route: "/", selector: "[data-lyra-globe]", heading: "Cristian Vega" },
  { name: "page", route: "/about/", selector: "[data-graphic='about']", heading: "Cristian Vega" },
];

/**
 * Read the completed canvas at the emulated device pixel ratio.
 * Compare foreground paint fractions in a 4 by 4 bitmap grid.
 */
async function readCanvasPaint(browser, baseAddress, sceneTarget, deviceScaleFactor) {
  const browserContext = await browser.newContext({ viewport: viewports.desktop, deviceScaleFactor });
  const page = await browserContext.newPage();
  await useReducedMotion(page);
  await page.goto(new URL(sceneTarget.route, baseAddress).href);
  await expect(page.locator(sceneTarget.selector)).toHaveAttribute("data-motion-state", "still");
  await settle(page);
  const canvasPaint = await page.locator(`${sceneTarget.selector} canvas`).evaluate((canvas) => {
    const { width, height } = canvas;
    const { data: pixelData } = canvas.getContext("2d").getImageData(0, 0, width, height);
    const cellPaintCounts = new Array(16).fill(0);
    let foregroundPixelCount = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (pixelData[(y * width + x) * 4 + 3] <= 140) continue;
        cellPaintCounts[Math.floor((y * 4) / height) * 4 + Math.floor((x * 4) / width)] += 1;
        foregroundPixelCount += 1;
      }
    }
    const canvasRectangle = canvas.getBoundingClientRect();
    return { ratio: devicePixelRatio, bitmapSize: [width, height], layoutSize: [canvasRectangle.width, canvasRectangle.height], cells: cellPaintCounts, foregroundPixelCount };
  });
  await browserContext.close();
  expect(canvasPaint.foregroundPixelCount, `${sceneTarget.name}: the canvas must contain foreground paint before pixel ratio comparison`).toBeGreaterThan(0);
  return { ...canvasPaint, cells: canvasPaint.cells.map((cellPixelCount) => cellPixelCount / canvasPaint.foregroundPixelCount) };
}

for (const [sceneTarget, deviceScaleFactor] of [[sceneTargets[1], 2], [sceneTargets[0], 1.5]]) {
  test(`${sceneTarget.name} draws the complete canvas at a device pixel ratio of ${deviceScaleFactor}`, async ({ browser, baseURL: baseAddress }) => {
    const referencePaint = await readCanvasPaint(browser, baseAddress, sceneTarget, 1);
    const scaledPaint = await readCanvasPaint(browser, baseAddress, sceneTarget, deviceScaleFactor);
    expect(scaledPaint.ratio).toBe(deviceScaleFactor);
    // Each tested ratio stays below its scene cap.
    // The bitmap dimensions must equal the layout dimensions multiplied by the ratio.
    expect(Math.abs(scaledPaint.bitmapSize[0] - scaledPaint.layoutSize[0] * deviceScaleFactor), `Bitmap ${scaledPaint.bitmapSize} must match layout ${scaledPaint.layoutSize} at pixel ratio ${deviceScaleFactor}`).toBeLessThanOrEqual(1);
    expect(Math.abs(scaledPaint.bitmapSize[1] - scaledPaint.layoutSize[1] * deviceScaleFactor), `Bitmap ${scaledPaint.bitmapSize} must match layout ${scaledPaint.layoutSize} at pixel ratio ${deviceScaleFactor}`).toBeLessThanOrEqual(1);
    // Complete canvases keep the paint distribution difference below 0.15 on macOS.
    // Cropped canvases increase that difference to 1.5 for the globe and 2 for About.
    const paintDistributionDifference = scaledPaint.cells.reduce((totalDifference, paintShare, cellIndex) => totalDifference + Math.abs(paintShare - referencePaint.cells[cellIndex]), 0);
    expect(paintDistributionDifference, "The higher pixel ratio must preserve the complete canvas paint distribution").toBeLessThan(0.5);
  });
}


test("Products resumes drift when reduced motion ends", async ({ page }) => {
  await useManualFrames(page);
  await page.goto(`${draftOrigin}/products/`);
  await expect(page.locator("[data-graphic='products']")).toHaveAttribute("data-motion-state", "playing");
  await expect.poll(() => pendingFrames(page)).toBe(1);
  await useReducedMotion(page);
  await expect(page.locator("[data-graphic='products']")).toHaveAttribute("data-motion-state", "still");
  expect(await pendingFrames(page)).toBe(0);
  await useReducedMotion(page, "no-preference");
  await expect(page.locator("[data-graphic='products']")).toHaveAttribute("data-motion-state", "playing");
  expect(await pendingFrames(page)).toBe(1);
});

for (const failureType of ["canvas", "resize", "intersection", "setup"]) {
  test(`A ${failureType} failure preserves the globe fallback and readable page content`, async ({ page }) => {
    await useManualFrames(page);
    await useLifetimeSpy(page);
    await useReducedMotion(page);
    await page.addInitScript((failureType) => {
      if (failureType === "canvas") HTMLCanvasElement.prototype.getContext = () => null;
      if (failureType === "resize") delete window.ResizeObserver;
      if (failureType === "intersection") delete window.IntersectionObserver;
      if (failureType === "setup") window.__failIntersection = true;
    }, failureType);
    const recordedPageProblems = [];
    page.on("pageerror", (error) => recordedPageProblems.push(error.message));
    await page.goto("/");
    const fallbackGraphic = page.locator("[data-lyra-globe] .lyra-globe__fallback");
    await expect(fallbackGraphic).toBeVisible();
    await expect(fallbackGraphic).toHaveCount(1);
    await expect(fallbackGraphic).toHaveCSS("opacity", "1");
    expect(await fallbackGraphic.locator("path.is-hot").count()).toBeGreaterThanOrEqual(10);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator(".hero__lede")).toBeVisible();
    expect(await pendingFrames(page)).toBe(0);
    expect(await readResourceCounts(page)).toEqual(emptyResourceCounts);
    await dispatchPageTransition(page, "pageshow");
    await expect(fallbackGraphic).toHaveCount(1);
    await page.goto("/about/");
    await expect(page.locator("[data-graphic]")).toBeHidden();
    await expect(page.locator("h1")).toBeVisible();
    expect(await pendingFrames(page)).toBe(0);
    expect(await readResourceCounts(page)).toEqual(emptyResourceCounts);
    expect(recordedPageProblems).toEqual([]);
  });
}

test("A failed globe restore removes resources and keeps one visible fallback", async ({ page }) => {
  await useManualFrames(page);
  await useLifetimeSpy(page);
  await page.goto("/");
  await expect(page.locator("[data-lyra-globe]")).toHaveAttribute("data-ready", "true");
  await expect.poll(() => pendingFrames(page)).toBe(1);
  await dispatchPageTransition(page, "pagehide");
  await page.evaluate(() => { window.__failIntersection = true; });
  await dispatchPageTransition(page, "pageshow");
  await expect(page.locator("[data-lyra-globe] .lyra-globe__fallback")).toHaveCount(1);
  await expect(page.locator("[data-lyra-globe] .lyra-globe__fallback")).toBeVisible();
  expect(await readResourceCounts(page)).toEqual(emptyResourceCounts);
  expect(await pendingFrames(page)).toBe(0);
  await dispatchPageTransition(page, "pageshow");
  await expect(page.locator("[data-lyra-globe] .lyra-globe__fallback")).toHaveCount(1);
  await expect(page.locator("[data-lyra-globe]")).not.toHaveAttribute("data-ready", /.*/);
  await expect(page.locator("h1")).toBeVisible();
});
