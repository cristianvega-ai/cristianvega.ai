import { expect, test } from "@playwright/test";
import { DRAFT_ORIGIN as draftOrigin, openGraphic, paintedPixels, pendingFrames, playFrames, useManualFrames, useReducedMotion, VIEWPORTS as viewports } from "../shared/browser-fixtures.mjs";

const productsTarget = { name: "Products", address: `${draftOrigin}/products/`, graphic: "[data-graphic='products']" };

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

test("The product scene stops requesting frames after motion completes", async ({ page }) => {
  await page.setViewportSize(viewports.desktop);
  await useManualFrames(page);
  await openGraphic(page, productsTarget);
  await expect(page.locator(productsTarget.graphic)).toHaveAttribute("data-motion-state", "playing");
  await playFrames(page, 32);
  const entrancePixelCount = await paintedPixels(page, productsTarget.graphic, 8);
  await playFrames(page, 33_000);
  await expect(page.locator(productsTarget.graphic)).toHaveAttribute("data-motion-state", "still");
  expect(await paintedPixels(page, productsTarget.graphic, 8), "The completed product entrance must increase foreground paint").toBeGreaterThan(entrancePixelCount);
  expect(await pendingFrames(page), "Completed product motion must queue no frames").toBe(0);
});
