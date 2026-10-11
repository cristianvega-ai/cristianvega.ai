import { expect, test } from "@playwright/test";
import { DRAFT_ORIGIN as draftOrigin, expectDecorativeGraphic, expectGraphicClearOfText, expectReadablePage, openGraphic, paintedPixels, pendingFrames, playFrames, settle, useManualFrames, useReducedMotion, VIEWPORTS as viewports } from "../shared/browser-fixtures.mjs";

const graphicTargets = [
  { name: "About", address: "/about/", graphic: "[data-graphic='about']" },
  { name: "Writing", address: `${draftOrigin}/writing/`, graphic: "[data-graphic='writing']" },
  { name: "Products", address: `${draftOrigin}/products/`, graphic: "[data-graphic='products']" },
  { name: "Product detail", address: `${draftOrigin}/products/product-layout-fixture/`, graphic: "[data-graphic='products']" },
  { name: "404", address: "/missing-graphic-check/", graphic: "[data-graphic='404']" },
];

// Check foreground paint in the desktop column and mobile band for every page graphic.
// Canvas controller tests cover pause, preference changes, observers, and restoration.
for (const graphicTarget of graphicTargets) {
  for (const viewport of [viewports.desktop, viewports.mobile]) {
    test(`${graphicTarget.name} draws a decorative scene clear of page text at ${viewport.width}px`, async ({ page }) => {
      const recordedPageProblems = [];
      page.on("pageerror", (error) => recordedPageProblems.push(error.message));
      page.on("console", (message) => {
        const expectedMissingPageError = graphicTarget.name === "404" && message.location().url.endsWith("/missing-graphic-check/") && message.text().includes("404");
        if (message.type() === "error" && !expectedMissingPageError) recordedPageProblems.push(message.text());
      });
      await page.setViewportSize(viewport);
      await useManualFrames(page);
      await useReducedMotion(page);
      await openGraphic(page, graphicTarget);
      await settle(page);
      await expectReadablePage(page);
      await expectDecorativeGraphic(page, graphicTarget.graphic);
      await expect(page.locator(graphicTarget.graphic)).toHaveAttribute("data-motion-state", "still");
      expect(await pendingFrames(page), `${graphicTarget.name}: reduced motion must queue no frames`).toBe(0);
      await expectGraphicClearOfText(page, graphicTarget.graphic);
      await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
      await expectGraphicClearOfText(page, graphicTarget.graphic);
      expect(recordedPageProblems).toEqual([]);
    });
  }
}

test("The product scene stops requesting frames after motion completes", async ({ page }) => {
  await page.setViewportSize(viewports.desktop);
  await useManualFrames(page);
  await openGraphic(page, graphicTargets[2]);
  await expect(page.locator(graphicTargets[2].graphic)).toHaveAttribute("data-motion-state", "playing");
  await playFrames(page, 32);
  const entrancePixelCount = await paintedPixels(page, graphicTargets[2].graphic, 8);
  await playFrames(page, 33_000);
  await expect(page.locator(graphicTargets[2].graphic)).toHaveAttribute("data-motion-state", "still");
  expect(await paintedPixels(page, graphicTargets[2].graphic, 8), "The completed product entrance must increase foreground paint").toBeGreaterThan(entrancePixelCount);
  expect(await pendingFrames(page), "Completed product motion must queue no frames").toBe(0);
});
