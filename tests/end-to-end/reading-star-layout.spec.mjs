import { expect, test } from "@playwright/test";
import { DRAFT_ORIGIN as draftOrigin, pageProblems, readingStar, settle, useReducedMotion } from "../shared/browser-fixtures.mjs";

const articlePath = "/writing/full-article-layout-fixture/";
// The star sits in the margin from 900px and becomes a pill below that width.
const marginWidths = [1440, 900];
const pillWidths = [899, 390];
const heightOfViewport = 800;
// The star pins this far from the top of the viewport while the page scrolls under it.
const pinnedTop = 26;
// The gap between the star circle and the title keeps the star clear of code blocks that hang outside the column.
const gapToTitle = 40;
const pillInset = 20;

/** Read the star circle and the first line of the page title in viewport pixels. */
const readGeometry = (page) =>
  page.evaluate(() => {
    const linkBox = document.querySelector(".reading-star__link").getBoundingClientRect();
    const titleText = document.querySelector("#page-title").firstChild;
    const titleRange = document.createRange();
    titleRange.selectNodeContents(titleText);
    const firstLine = titleRange.getClientRects()[0];
    const titleBox = document.querySelector("#page-title").getBoundingClientRect();
    return {
      link: { left: linkBox.left, right: linkBox.right, top: linkBox.top, bottom: linkBox.bottom, width: linkBox.width },
      firstLineCentre: firstLine.top + firstLine.height / 2,
      titleLeft: titleBox.left,
      viewportHeight: innerHeight,
      viewportWidth: document.documentElement.clientWidth,
      position: getComputedStyle(document.querySelector(".reading-star")).position,
    };
  });

test.beforeEach(async ({ page }) => {
  await useReducedMotion(page);
});

for (const width of marginWidths) {
  test(`The star sits in the left margin, level with the title, at ${width}px`, async ({ page }) => {
    const recordedPageProblems = pageProblems(page);
    await page.setViewportSize({ width, height: heightOfViewport });
    await page.goto(draftOrigin + articlePath);
    await settle(page);
    const geometry = await readGeometry(page);
    const starCentre = (geometry.link.top + geometry.link.bottom) / 2;
    expect(Math.abs(starCentre - geometry.firstLineCentre), `Star at ${width}px: its centre must be level with the first line of the title`).toBeLessThanOrEqual(2);
    expect(geometry.titleLeft - geometry.link.right, `Star at ${width}px: the gap to the title must be ${gapToTitle} pixels`).toBeCloseTo(gapToTitle, 0);
    expect(geometry.link.left, `Star at ${width}px: the star must stay inside the viewport left edge`).toBeGreaterThanOrEqual(0);
    await expect(readingStar(page).label, `Star at ${width}px: the label must stay hidden until the star has hover or focus`).toHaveCSS("opacity", "0");
    expect(recordedPageProblems).toEqual([]);
  });

  test(`The star pins ${pinnedTop} pixels from the top while the page scrolls at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: heightOfViewport });
    await page.goto(draftOrigin + articlePath);
    await settle(page);
    const topAtStart = (await readGeometry(page)).link.top;
    expect(topAtStart, `Star at ${width}px: before a scroll it must sit below the pin position`).toBeGreaterThan(pinnedTop + 20);
    const maximumScroll = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    expect(maximumScroll, "The article must scroll far enough to test the pin").toBeGreaterThan(1200);
    for (const scrollTop of [Math.round(maximumScroll / 3), Math.round(maximumScroll / 2), maximumScroll]) {
      await page.evaluate((top) => scrollTo({ top, behavior: "instant" }), scrollTop);
      await expect.poll(async () => (await readGeometry(page)).link.top, { message: `Star at ${width}px: it must stay ${pinnedTop} pixels from the top at scroll ${scrollTop}` }).toBeCloseTo(pinnedTop, 0);
    }
  });

  test(`The star label opens on keyboard focus at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: heightOfViewport });
    await page.goto(draftOrigin + articlePath);
    await settle(page);
    const { link, label } = readingStar(page);
    await link.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(link).toBeFocused();
    await expect(label, `Star at ${width}px: the label must show when the star has keyboard focus`).toHaveCSS("opacity", "1");
    await expect(label).toHaveText("Writing");
    const linkBox = await link.boundingBox();
    expect(linkBox.width, `Star at ${width}px: the open label must widen the star beyond the circle`).toBeGreaterThan(60);
  });
}

for (const width of pillWidths) {
  test(`The star is a pill at the bottom left with its label visible at ${width}px`, async ({ page }) => {
    const recordedPageProblems = pageProblems(page);
    await page.setViewportSize({ width, height: heightOfViewport });
    await page.goto(draftOrigin + articlePath);
    await settle(page);
    const { label } = readingStar(page);
    await expect(label, `Star at ${width}px: the label must be visible with no hover`).toBeVisible();
    await expect(label).toHaveCSS("opacity", "1");
    const maximumScroll = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    for (const scrollTop of [0, Math.round(maximumScroll / 2), maximumScroll]) {
      await page.evaluate((top) => scrollTo({ top, behavior: "instant" }), scrollTop);
      await expect.poll(async () => {
        const geometry = await readGeometry(page);
        return [geometry.position, Math.round(geometry.link.left), Math.round(geometry.viewportHeight - geometry.link.bottom)];
      }, { message: `Star at ${width}px: it must stay fixed ${pillInset} pixels from the left and bottom at scroll ${scrollTop}` }).toEqual(["fixed", pillInset, pillInset]);
    }
    const geometry = await readGeometry(page);
    expect(geometry.link.right, `Star at ${width}px: the pill must stay inside the viewport right edge`).toBeLessThanOrEqual(geometry.viewportWidth);
    const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(horizontalOverflow, `Star at ${width}px: the page must have no horizontal overflow`).toBeLessThanOrEqual(1);
    expect(recordedPageProblems).toEqual([]);
  });
}
