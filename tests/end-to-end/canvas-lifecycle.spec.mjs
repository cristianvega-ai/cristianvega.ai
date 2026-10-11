import { expect, test } from "@playwright/test";

import { activeResourceCounts, dispatchPageTransition, mountScene, pausedResourceCounts, pendingFrames, readControllerClock, readResourceCounts, stepFrame } from "../shared/browser-fixtures.mjs";

for (const canvasPolicy of ["page", "globe"]) {
  test.describe(`${canvasPolicy} canvas controller`, () => {
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
    });
  });
}
