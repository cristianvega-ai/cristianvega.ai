import { expect, test } from "@playwright/test";
import { homeSections } from "../shared/node-helpers.mjs";
import { currentContent, DRAFT_ORIGIN as draftOrigin, pageProblems, settle, useReducedMotion } from "../shared/browser-fixtures.mjs";

// The Lab row of the homepage shows a small clip that trails the pointer. It needs a fine pointer and allowed motion.
// The draft server lists the Lab draft and serves its media, so these tests need no published build.

const labSection = homeSections(currentContent, { includeDrafts: true }).find((homeSection) => homeSection.section === "lab");
const labRowSelector = "section.home-section[aria-labelledby='lab-label'] a.entry-row";
const preview = (page) => page.locator(".row-preview");

test("A Lab row names its preview clip and poster, and the other rows name none", async ({ page }) => {
  expect(labSection, "The Lab fixtures must fill the Lab section").toBeDefined();
  await page.goto(draftOrigin + "/");
  const experiment = labSection.rows[0];
  const clipName = experiment.data.results.length > 1 ? "mosaic" : experiment.data.results[0].slug;
  const row = page.locator(labRowSelector).first();
  await expect(row).toHaveAttribute("data-preview-av1", `/lab/media/${experiment.id}/clips/${clipName}.av1.mp4`);
  await expect(row).toHaveAttribute("data-preview-h264", `/lab/media/${experiment.id}/clips/${clipName}.h264.mp4`);
  await expect(row).toHaveAttribute("data-preview-poster", `/lab/media/${experiment.id}/posters/${clipName}.webp`);
  await expect(page.locator("section.home-section:not([aria-labelledby='lab-label']) a[data-preview-av1]"), "Other sections: no row may name a preview").toHaveCount(0);
});

test("The preview shows over a Lab row while the pointer is on it and hides when the pointer leaves", async ({ page }) => {
  const recordedPageProblems = pageProblems(page);
  await useReducedMotion(page, "no-preference");
  await page.goto(draftOrigin + "/");
  await settle(page);
  await expect(preview(page), "Preview: the page must build a hidden preview for a fine pointer").not.toHaveClass(/row-preview--visible/);
  await expect(preview(page)).toHaveCount(1);
  const row = page.locator(labRowSelector).first();
  await row.hover();
  await expect(preview(page)).toHaveClass(/\brow-preview--visible\b/);
  await expect(preview(page)).toHaveAttribute("aria-hidden", "true");
  const sources = preview(page).locator("video source");
  expect(await sources.evaluateAll((elements) => elements.map((element) => [element.getAttribute("src"), element.getAttribute("type")])), "Preview: the clip must list AV1 first, then H.264")
    .toEqual([[await row.getAttribute("data-preview-av1"), 'video/mp4; codecs="av01.0.04M.08"'], [await row.getAttribute("data-preview-h264"), "video/mp4"]]);
  await expect(preview(page).locator("video")).toHaveJSProperty("poster", new URL(await row.getAttribute("data-preview-poster"), draftOrigin).href);
  // The preview trails the pointer, so it must end up beside the row.
  const rowBox = await row.boundingBox();
  await expect.poll(async () => (await preview(page).boundingBox()).x, { message: "Preview: the preview must move toward the pointer" }).toBeGreaterThan(rowBox.x);

  await page.mouse.move(5, 5);
  await expect(preview(page)).not.toHaveClass(/row-preview--visible/);
  expect(recordedPageProblems).toEqual([]);
});

test("The preview does not appear on a row of another section", async ({ page }) => {
  await useReducedMotion(page, "no-preference");
  await page.goto(draftOrigin + "/");
  await settle(page);
  await page.locator("section.home-section[aria-labelledby='writing-label'] a.entry-row").first().hover();
  await expect(preview(page)).not.toHaveClass(/row-preview--visible/);
});

test.describe("when the preview must stay away", () => {
  test("Reduced motion shows no preview", async ({ page }) => {
    await useReducedMotion(page);
    await page.goto(draftOrigin + "/");
    await settle(page);
    await page.locator(labRowSelector).first().hover();
    await expect(page.locator(".row-preview--visible")).toHaveCount(0);
    await expect(page.locator(labRowSelector).first(), "Reduced motion: the row must still lead to its experiment").toHaveAttribute("href", `/lab/${labSection.rows[0].id}/`);
  });

  test("A touch screen builds no preview", async ({ browser }) => {
    const browserContext = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 }, reducedMotion: "no-preference" });
    try {
      const page = await browserContext.newPage();
      await page.goto(draftOrigin + "/");
      expect(await page.evaluate(() => matchMedia("(hover: hover) and (pointer: fine)").matches), "The touch context must have no fine pointer").toBe(false);
      await expect(page.locator(labRowSelector).first()).toBeVisible();
      await expect(page.locator(".row-preview"), "Touch: the page must not build a preview").toHaveCount(0);
    } finally {
      await browserContext.close();
    }
  });
});
