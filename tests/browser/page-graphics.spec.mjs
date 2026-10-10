import { expect, test } from "@playwright/test";
import { DRAFT_ORIGIN, expectDecorativeGraphic, expectGraphicClearOfText, expectReadablePage, openGraphic, paintedPixels, pendingFrames, playFrames, settle, useManualFrames, useReducedMotion, VIEWPORTS } from "./fixtures.mjs";

const pages = [
  { name: "About", address: "/about/", graphic: "[data-graphic='about']" },
  { name: "Writing", address: `${DRAFT_ORIGIN}/writing/`, graphic: "[data-graphic='writing']" },
  { name: "Products", address: `${DRAFT_ORIGIN}/products/`, graphic: "[data-graphic='products']" },
  { name: "Product detail", address: `${DRAFT_ORIGIN}/products/product-layout-fixture/`, graphic: "[data-graphic='products']" },
  { name: "404", address: "/missing-graphic-check/", graphic: "[data-graphic='404']" },
];

// Every adapter must draw foreground paint in its fixed box and mobile band.
// Controller tests own pause, preference changes, observers, and generic restoration.
for (const target of pages) {
  for (const viewport of [VIEWPORTS.desktop, VIEWPORTS.mobile]) {
    test(`${target.name} draws a decorative scene without hiding text at ${viewport.width}px`, async ({ page }) => {
      const problems = [];
      page.on("pageerror", (error) => problems.push(error.message));
      page.on("console", (message) => {
        const missingPage = target.name === "404" && message.location().url.endsWith("/missing-graphic-check/") && message.text().includes("404");
        if (message.type() === "error" && !missingPage) problems.push(message.text());
      });
      await page.setViewportSize(viewport);
      await useManualFrames(page);
      await useReducedMotion(page);
      await openGraphic(page, target);
      await settle(page);
      await expectReadablePage(page);
      await expectDecorativeGraphic(page, target.graphic);
      await expect(page.locator(target.graphic)).toHaveAttribute("data-motion-state", "still");
      expect(await pendingFrames(page), `${target.name}: reduced motion must queue no frame`).toBe(0);
      await expectGraphicClearOfText(page, target.graphic);
      await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
      await expectGraphicClearOfText(page, target.graphic);
      expect(problems).toEqual([]);
    });
  }
}

test("a moving product scene finishes and stops its clock", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await useManualFrames(page);
  await openGraphic(page, pages[2]);
  await expect(page.locator(pages[2].graphic)).toHaveAttribute("data-motion-state", "playing");
  await playFrames(page, 32);
  const early = await paintedPixels(page, pages[2].graphic, 8);
  await playFrames(page, 33_000);
  await expect(page.locator(pages[2].graphic)).toHaveAttribute("data-motion-state", "still");
  expect(await paintedPixels(page, pages[2].graphic, 8), "the entrance reveals the products").toBeGreaterThan(early);
  expect(await pendingFrames(page), "finished product motion must stop its clock").toBe(0);
});
