import { expect, test } from "@playwright/test";
import { pendingFrames, useManualFrames, useReducedMotion, VIEWPORTS } from "./fixtures.mjs";

const graphic = "[data-graphic='about']";

test.use({ viewport: { width: 1440, height: 600 } });

test("maps the reader's place to the whole path: the start at the top, Vega at the bottom", async ({ page }) => {
    await page.goto("/about/");
    await expect(page.locator(graphic)).toHaveAttribute("data-motion-state", "still", { timeout: 10_000 });
    const progress = async () => Number(await page.locator(graphic).getAttribute("data-progress"));
    const scrollToPageFraction = (where) => page.evaluate((share) => scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * share), where);

    await expect.poll(progress, "rests at the start of the path at the top").toBeCloseTo(0, 2);
    await scrollToPageFraction(0.5);
    await expect.poll(progress).toBeGreaterThan(0.45);
    await expect.poll(progress).toBeLessThan(0.55);
    await scrollToPageFraction(1);
    await expect.poll(progress, "reaches Vega at the bottom").toBeCloseTo(1, 2);
    // The loop stops once the marker reaches the reader.
    await expect(page.locator(graphic)).toHaveAttribute("data-motion-state", "still");
    await scrollToPageFraction(0);
    await expect.poll(progress).toBeCloseTo(0, 2);
  });

test("rests on the full path when the page cannot scroll", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 5000 });
    await page.goto("/about/");
    await expect(page.locator(graphic)).toHaveAttribute("data-motion-state", "still", { timeout: 10_000 });
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), "the page fits the window").toBe(true);
    await expect(page.locator(graphic)).toHaveAttribute("data-progress", "1");
  });

test("reduced motion lights the path to the reader's place and the marker jumps without easing", async ({ page }) => {
    await useManualFrames(page);
    await useReducedMotion(page);
    await page.goto("/about/");
    await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
    // No frame runs, so a value that follows the scroll at once cannot come from an eased marker.
    await page.evaluate(() => scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * 0.5));
    await expect.poll(async () => Number(await page.locator(graphic).getAttribute("data-progress"))).toBeGreaterThan(0.45);
    expect(Number(await page.locator(graphic).getAttribute("data-progress"))).toBeLessThan(0.55);
    expect(await pendingFrames(page)).toBe(0);
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await expect(page.locator(graphic)).toHaveAttribute("data-progress", "1");
    expect(await pendingFrames(page)).toBe(0);
  });

test("About keeps its profile readable without JavaScript", async ({ browser, baseURL: baseAddress }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: VIEWPORTS.mobile });
  try {
    const page = await context.newPage();
    await page.goto(new URL("/about/", baseAddress).href);
    await expect(page.locator(graphic)).toBeHidden();
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator(".about__lede")).toBeVisible();
    await expect(page.locator(".about__profile")).toBeVisible();
  } finally {
    await context.close();
  }
});

test("About removes its scroll listener and restores reader tracking", async ({ page }) => {
  await useReducedMotion(page);
  await page.addInitScript(() => {
    const listeners = new Set();
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      if (this === window && type === "scroll") listeners.add(listener);
      return add.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function (type, listener, options) {
      if (this === window && type === "scroll") listeners.delete(listener);
      return remove.call(this, type, listener, options);
    };
    window.__scrollListeners = () => listeners.size;
  });
  await page.goto("/about/");
  await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
  expect(await page.evaluate(() => window.__scrollListeners()), "one reader listener attaches").toBe(1);
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
  expect(await page.evaluate(() => window.__scrollListeners()), "pagehide must remove the reader listener").toBe(0);
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
  expect(await page.evaluate(() => window.__scrollListeners()), "one reader listener returns after restore").toBe(1);
  await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
  await expect(page.locator(graphic)).toHaveAttribute("data-progress", "1");
});
