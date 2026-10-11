import { expect, test } from "@playwright/test";
import { paintedPixels, pendingFrames, playFrames, settle, useManualFrames, useReducedMotion, VIEWPORTS as viewports } from "../shared/browser-fixtures.mjs";

const globeSelector = "[data-lyra-globe]";
const labelSelector = `${globeSelector} .lyra-globe__label`;
const readLabelOpacities = (page) => page.locator(labelSelector).evaluateAll((nodes) => nodes.map((node) => Number(getComputedStyle(node).opacity)));
const dispatchPageTransition = (page, transitionType) => page.evaluate((transitionType) => {
  window.dispatchEvent(new PageTransitionEvent(transitionType, { persisted: true }));
}, transitionType);

test.use({ viewport: viewports.desktop });

async function finishLabels(page) {
  await expect(page.locator(globeSelector)).toHaveAttribute("data-motion-state", "still");
  const labelOpacities = await readLabelOpacities(page);
  expect(labelOpacities.length, "The globe must supply labels before the visibility check").toBeGreaterThan(0);
  expect(labelOpacities.every((labelOpacity) => labelOpacity > 0), "Completed globe labels must have positive opacity").toBe(true);
  await expect.poll(() => page.locator(labelSelector).evaluateAll((nodes) => nodes.flatMap((node) => node.getAnimations()).length)).toBe(0);
  await settle(page);
}

test("Globe labels pause with the canvas when the tab becomes hidden", async ({ page }) => {
  await useManualFrames(page);
  await page.goto("/");
  await expect(page.locator(globeSelector)).toHaveAttribute("data-ready", "true");
  await playFrames(page, 800);
  await expect.poll(async () => (await readLabelOpacities(page))[1]).toBeGreaterThan(0);
  const pausedOpacities = await readLabelOpacities(page);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(await pendingFrames(page), "The hidden globe must queue no frames").toBe(0);
  await playFrames(page, 3000);
  expect(await readLabelOpacities(page), "Hidden globe labels must preserve their paused opacity").toEqual(pausedOpacities);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(await pendingFrames(page)).toBe(1);
  await playFrames(page, 3000);
  await finishLabels(page);
  expect(await pendingFrames(page)).toBe(0);
});

test("A restored globe replays its entrance and completes its labels", async ({ page }) => {
  await useManualFrames(page);
  await page.goto("/");
  await expect(page.locator(globeSelector)).toHaveAttribute("data-ready", "true");
  await playFrames(page, 3000);
  await finishLabels(page);
  await dispatchPageTransition(page, "pagehide");
  expect(await pendingFrames(page), "The globe must cancel queued frames on pagehide").toBe(0);
  await expect(page.locator(globeSelector)).not.toHaveAttribute("data-ready", /.*/);
  await dispatchPageTransition(page, "pageshow");
  await expect(page.locator(globeSelector)).toHaveAttribute("data-motion-state", "playing");
  expect(await pendingFrames(page)).toBe(1);
  await playFrames(page, 3000);
  await finishLabels(page);
});

test("Globe labels complete under reduced motion and live preference changes", async ({ page }) => {
  await useManualFrames(page);
  await useReducedMotion(page);
  await page.goto("/");
  await finishLabels(page);
  expect(await pendingFrames(page)).toBe(0);
  await useReducedMotion(page, "no-preference");
  await finishLabels(page);
  await dispatchPageTransition(page, "pagehide");
  await dispatchPageTransition(page, "pageshow");
  await expect(page.locator(globeSelector)).toHaveAttribute("data-ready", "true");
  await expect.poll(() => pendingFrames(page)).toBe(1);
  expect(await readLabelOpacities(page)).toEqual([0, 0]);
  await playFrames(page, 816);
  await useReducedMotion(page);
  await finishLabels(page);
  expect(await pendingFrames(page)).toBe(0);
});

// Check globe dimensions after stylesheet failure in both navigation layouts.
for (const viewport of [viewports.desktop, viewports.mobile]) {
  test(`Home preserves a readable globe after stylesheet failure at ${viewport.width}px`, async ({ page }) => {
    const recordedPageProblems = [];
    page.on("pageerror", (error) => recordedPageProblems.push(error.message));
    page.on("console", (message) => {
      const blockedStylesheet = message.location().url.includes("/globe-projection/") && message.text().includes("ERR_FAILED");
      if (message.type() === "error" && !blockedStylesheet) recordedPageProblems.push(message.text());
    });
    await page.setViewportSize(viewport);
    await useReducedMotion(page);
    await page.route("**/globe-projection/**", (route) => route.abort());
    await page.goto("/");
    await expect(page.locator(globeSelector)).toHaveAttribute("data-ready", "true");
    await finishLabels(page);
    await expect(page.locator("h1")).toBeVisible();
    const globeRectangle = await page.locator(globeSelector).boundingBox();
    expect(globeRectangle.width, "The globe width must exceed 100 pixels when its stylesheet fails").toBeGreaterThan(100);
    expect(globeRectangle.height, "The globe height must exceed 100 pixels when its stylesheet fails").toBeGreaterThan(100);
    expect(await paintedPixels(page, globeSelector, 8), "The globe must preserve foreground paint when its stylesheet fails").toBeGreaterThan(100);
    expect(recordedPageProblems).toEqual([]);
  });
}
