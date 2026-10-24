import { expect, test } from "@playwright/test";
import { DRAFT_ORIGIN as draftOrigin, readingStar, settle, useReducedMotion, VIEWPORTS as viewports } from "../shared/browser-fixtures.mjs";

const articlePath = "/writing/full-article-layout-fixture/";
const shortPagePath = "/missing-reading-progress-check/";
const lineCount = 6;

test.beforeEach(async ({ page }) => {
  await useReducedMotion(page);
});

/** Read how much of each figure line is undrawn: 1 is hidden, 0 is drawn. */
const readHiddenShares = (page) =>
  readingStar(page).lines.evaluateAll((lines) => lines.map((line) => Number.parseFloat(line.style.strokeDashoffset)));

const scrollToShare = (page, share) =>
  page.evaluate((scrollShare) => scrollTo({ top: Math.round((document.documentElement.scrollHeight - innerHeight) * scrollShare), behavior: "instant" }), share);

test("The figure lines draw in turn as the reader scrolls down and clear when the reader returns", async ({ page }) => {
  await page.setViewportSize(viewports.desktop);
  await page.goto(draftOrigin + articlePath);
  await settle(page);
  const { star, lines } = readingStar(page);
  await expect(lines).toHaveCount(lineCount);
  expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight), "The article must scroll").toBeGreaterThan(1200);

  await expect.poll(() => readHiddenShares(page), { message: "Reading star: at the top of the page every line must be hidden" }).toEqual(Array(lineCount).fill(1));

  // At the middle of the page the first three lines are drawn and the last three have not started.
  await scrollToShare(page, 0.5);
  await expect.poll(async () => (await readHiddenShares(page)).map((share) => Math.round(share * 10) / 10), { message: "Reading star: at half the page the first half of the lines must be drawn" })
    .toEqual([0, 0, 0, 1, 1, 1]);

  // Between the checkpoints the lines draw in order: no later line starts before an earlier line ends.
  for (const scrollShare of [0.1, 0.25, 0.4, 0.6, 0.75, 0.9]) {
    await scrollToShare(page, scrollShare);
    await expect.poll(async () => {
      const hiddenShares = await readHiddenShares(page);
      const drawnLines = hiddenShares.map((share) => 1 - share);
      const inOrder = drawnLines.every((drawn, lineIndex) => lineIndex === 0 || drawn <= drawnLines[lineIndex - 1] + 1e-9);
      return inOrder && hiddenShares.every((share) => share >= 0 && share <= 1);
    }, { message: `Reading star: at ${scrollShare * 100} percent each line must draw only after the line before it` }).toBe(true);
  }

  await expect(star, "Reading star: before the end of the page Vega must stay dark").not.toHaveClass(/reading-star--complete/);
  await scrollToShare(page, 1);
  await expect.poll(() => readHiddenShares(page), { message: "Reading star: at the end of the page every line must be drawn" }).toEqual(Array(lineCount).fill(0));
  await expect(star, "Reading star: at the end of the page Vega must light").toHaveClass(/reading-star--complete/);

  await scrollToShare(page, 0);
  await expect.poll(() => readHiddenShares(page), { message: "Reading star: scrolling back up must hide the lines again" }).toEqual(Array(lineCount).fill(1));
  await expect(star, "Reading star: scrolling back up must darken Vega").not.toHaveClass(/reading-star--complete/);
});

test("Vega lights near the end of the page and not at 90 percent", async ({ page }) => {
  await page.setViewportSize(viewports.desktop);
  await page.goto(draftOrigin + articlePath);
  await settle(page);
  const { star } = readingStar(page);
  await scrollToShare(page, 0.9);
  // At 90 percent the first five lines are drawn and the last line is still on its way to Vega.
  await expect.poll(async () => (await readHiddenShares(page)).slice(0, lineCount - 1), { message: "Reading star: at 90 percent the first five lines must be drawn" })
    .toEqual(Array(lineCount - 1).fill(0));
  await expect(star, "Reading star: Vega must stay dark at 90 percent").not.toHaveClass(/reading-star--complete/);
  await scrollToShare(page, 0.99);
  await expect(star, "Reading star: Vega must light at 99 percent of the page").toHaveClass(/reading-star--complete/);
});

test("A page that does not scroll shows the whole figure with Vega lit", async ({ page }) => {
  await page.setViewportSize(viewports.desktop);
  const response = await page.goto(shortPagePath);
  expect(response.status()).toBe(404);
  await settle(page);
  expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight), "The missing page must not scroll at this height").toBeLessThan(8);
  await expect.poll(() => readHiddenShares(page), { message: "Reading star: a short page must draw every line at once" }).toEqual(Array(lineCount).fill(0));
  await expect(readingStar(page).star, "Reading star: a short page must light Vega at once").toHaveClass(/reading-star--complete/);
});

test("The star measures the page again when the viewport shrinks and the page begins to scroll", async ({ page }) => {
  await page.setViewportSize(viewports.desktop);
  await page.goto(shortPagePath);
  await settle(page);
  const { star } = readingStar(page);
  await expect(star).toHaveClass(/reading-star--complete/);
  await page.setViewportSize({ width: 390, height: 240 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - innerHeight), { message: "The missing page must scroll in a short viewport" }).toBeGreaterThan(8);
  await expect.poll(() => readHiddenShares(page), { message: "Reading star: after the page begins to scroll, the lines must wait for the reader" }).toEqual(Array(lineCount).fill(1));
  await expect(star, "Reading star: Vega must darken once the page scrolls").not.toHaveClass(/reading-star--complete/);
  await scrollToShare(page, 1);
  await expect(star, "Reading star: Vega must light at the end of the short viewport").toHaveClass(/reading-star--complete/);
});

test("The star measures the page again when only the viewport height changes", async ({ page }) => {
  await page.setViewportSize({ width: viewports.desktop.width, height: 800 });
  await page.goto(draftOrigin + articlePath);
  await settle(page);
  await scrollToShare(page, 0.5);
  await expect.poll(async () => (await readHiddenShares(page)).map((share) => Math.round(share * 10) / 10), { message: "Reading star: at half the page the first three lines must be drawn" })
    .toEqual([0, 0, 0, 1, 1, 1]);
  // A shorter viewport adds scroll range below the reader. The reader stays where they are, so progress falls and the third line is no longer whole.
  // The body keeps its size and the page fires no scroll event, so only the resize listener can redraw the figure.
  await page.setViewportSize({ width: viewports.desktop.width, height: 400 });
  await expect.poll(async () => (await readHiddenShares(page))[2], { message: "Reading star: a height-only resize must redraw the figure for the new scroll range" }).toBeGreaterThan(0.05);
});
