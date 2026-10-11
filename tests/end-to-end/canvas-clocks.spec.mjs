import { expect, test } from "@playwright/test";

import { mountScene, pendingFrames, readControllerClock } from "../shared/browser-fixtures.mjs";

const setDocumentHidden = (page, documentHidden) => page.evaluate((hiddenValue) => {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hiddenValue });
  document.dispatchEvent(new Event("visibilitychange"));
}, documentHidden);

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
