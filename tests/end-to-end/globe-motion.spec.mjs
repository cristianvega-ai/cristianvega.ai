import { expect, test } from "@playwright/test";
import { paintedPixels, pendingFrames, playFrames, useManualFrames, useReducedMotion, VIEWPORTS as viewports } from "../shared/browser-fixtures.mjs";

const globeSelector = "[data-lyra-globe]";

test("The globe stops requesting frames after its entrance completes", async ({ page }) => {
  await page.setViewportSize(viewports.desktop);
  await useManualFrames(page);
  await page.goto("/");
  await expect(page.locator(globeSelector)).toHaveAttribute("data-motion-state", "playing");
  await playFrames(page, 32);
  const entrancePixelCount = await paintedPixels(page, globeSelector, 8);
  await playFrames(page, 3000);
  await expect(page.locator(globeSelector)).toHaveAttribute("data-motion-state", "still");
  expect(await paintedPixels(page, globeSelector, 8), "The completed globe entrance must increase foreground paint").toBeGreaterThan(entrancePixelCount);
  expect(await pendingFrames(page), "The completed globe entrance must queue no frames").toBe(0);
});

test("The globe draws with no queued frames when reduced motion applies", async ({ page }) => {
  await useManualFrames(page);
  await useReducedMotion(page);
  await page.goto("/");
  await expect(page.locator(globeSelector)).toHaveAttribute("data-motion-state", "still");
  expect(await paintedPixels(page, globeSelector, 8), "The globe must contain foreground paint under reduced motion").toBeGreaterThan(100);
  expect(await pendingFrames(page)).toBe(0);
});
