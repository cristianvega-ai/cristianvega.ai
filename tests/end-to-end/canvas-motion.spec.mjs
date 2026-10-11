import { expect, test } from "@playwright/test";

import { activeResourceCounts, dispatchPageTransition, mountScene, pendingFrames, readControllerClock, readResourceCounts, useDeferredPreference, useReducedMotion } from "../shared/browser-fixtures.mjs";

for (const canvasPolicy of ["page", "globe"]) {
  test.describe(`${canvasPolicy} canvas controller`, () => {
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
