import { expect, test } from "@playwright/test";
import { pendingFrames, useManualFrames, useReducedMotion } from "../shared/browser-fixtures.mjs";

const graphicSelector = "[data-graphic='about']";

test.use({ viewport: { width: 1440, height: 600 } });

test("About maps scroll position to path progress from the start to Vega", async ({ page }) => {
    await page.goto("/about/");
    await expect(page.locator(graphicSelector)).toHaveAttribute("data-motion-state", "still", { timeout: 10_000 });
    const readPathProgress = async () => Number(await page.locator(graphicSelector).getAttribute("data-progress"));
    const scrollToPageFraction = (pageFraction) => page.evaluate((pageFraction) => scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * pageFraction), pageFraction);

    await expect.poll(readPathProgress, "The About path must start at zero progress at the page top").toBeCloseTo(0, 2);
    await scrollToPageFraction(0.5);
    await expect.poll(readPathProgress).toBeGreaterThan(0.45);
    await expect.poll(readPathProgress).toBeLessThan(0.55);
    await scrollToPageFraction(1);
    await expect.poll(readPathProgress, "The About path must reach full progress at the page bottom").toBeCloseTo(1, 2);
    // The animation stops when the marker reaches the scroll position.
    await expect(page.locator(graphicSelector)).toHaveAttribute("data-motion-state", "still");
    await scrollToPageFraction(0);
    await expect.poll(readPathProgress).toBeCloseTo(0, 2);
  });

test("About completes the path when the page cannot scroll", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 5000 });
    await page.goto("/about/");
    await expect(page.locator(graphicSelector)).toHaveAttribute("data-motion-state", "still", { timeout: 10_000 });
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), "The About page must fit inside the viewport").toBe(true);
    await expect(page.locator(graphicSelector)).toHaveAttribute("data-progress", "1");
  });

test("About updates path progress immediately with no frames under reduced motion", async ({ page }) => {
    await useManualFrames(page);
    await useReducedMotion(page);
    await page.goto("/about/");
    await expect(page.locator(graphicSelector)).toHaveAttribute("data-ready", "true");
    // Immediate progress without frames proves that reduced motion bypasses marker easing.
    await page.evaluate(() => scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * 0.5));
    await expect.poll(async () => Number(await page.locator(graphicSelector).getAttribute("data-progress"))).toBeGreaterThan(0.45);
    expect(Number(await page.locator(graphicSelector).getAttribute("data-progress"))).toBeLessThan(0.55);
    expect(await pendingFrames(page)).toBe(0);
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await expect(page.locator(graphicSelector)).toHaveAttribute("data-progress", "1");
    expect(await pendingFrames(page)).toBe(0);
  });

test("About removes its scroll listener on pagehide and restores reader tracking on pageshow", async ({ page }) => {
  await useReducedMotion(page);
  await page.addInitScript(() => {
    const scrollListeners = new Set();
    const originalAddEventListener = EventTarget.prototype.addEventListener;
    const originalRemoveEventListener = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (eventType, listener, listenerOptions) {
      if (this === window && eventType === "scroll") scrollListeners.add(listener);
      return originalAddEventListener.call(this, eventType, listener, listenerOptions);
    };
    EventTarget.prototype.removeEventListener = function (eventType, listener, listenerOptions) {
      if (this === window && eventType === "scroll") scrollListeners.delete(listener);
      return originalRemoveEventListener.call(this, eventType, listener, listenerOptions);
    };
    window.__scrollListeners = () => scrollListeners.size;
  });
  await page.goto("/about/");
  await expect(page.locator(graphicSelector)).toHaveAttribute("data-ready", "true");
  expect(await page.evaluate(() => window.__scrollListeners()), "The About page must attach one scroll listener").toBe(1);
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
  expect(await page.evaluate(() => window.__scrollListeners()), "The About page must remove its scroll listener on pagehide").toBe(0);
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await expect(page.locator(graphicSelector)).toHaveAttribute("data-ready", "true");
  expect(await page.evaluate(() => window.__scrollListeners()), "The About page must restore one scroll listener on pageshow").toBe(1);
  await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
  await expect(page.locator(graphicSelector)).toHaveAttribute("data-progress", "1");
});
