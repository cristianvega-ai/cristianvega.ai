import { expect, test } from "@playwright/test";
import { DRAFT_ORIGIN as draftOrigin, focusRingAndFade, settle, tabTo, useReducedMotion, VIEWPORTS as viewports } from "../shared/browser-fixtures.mjs";

const articlePath = "/writing/full-article-layout-fixture/";

test("Wide article code and diagrams scroll within the column and show keyboard focus", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto(draftOrigin + articlePath);
  await settle(page);

  for (const selector of [".prose pre", ".figure__panel"]) {
    const scrollableBlock = page.locator(selector).first();
    const blockLayout = await scrollableBlock.evaluate((element) => {
      const rectangle = element.getBoundingClientRect();
      return {
        overflowX: getComputedStyle(element).overflowX,
        scrollsHorizontally: element.scrollWidth > element.clientWidth,
        right: rectangle.right,
        viewportWidth: document.documentElement.clientWidth,
        tabIndex: element.tabIndex,
      };
    });
    expect(blockLayout.overflowX, `${selector}: the article block must allow horizontal scrolling`).toBe("auto");
    expect(blockLayout.scrollsHorizontally, `${selector}: the wide article block must contain horizontal overflow`).toBe(true);
    expect(blockLayout.right, `${selector}: the article block must stay inside the viewport right edge`).toBeLessThanOrEqual(blockLayout.viewportWidth);
    expect(blockLayout.tabIndex, `${selector}: the article block must accept keyboard focus`).toBe(0);

    // Check keyboard focus, the focus ring, and horizontal keyboard scrolling.
    await scrollableBlock.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(scrollableBlock).toBeFocused();
    const focusRing = await scrollableBlock.evaluate((element) => {
      const computedStyle = getComputedStyle(element);
      return { outlineStyle: computedStyle.outlineStyle, outlineWidth: parseFloat(computedStyle.outlineWidth), outlineOffset: parseFloat(computedStyle.outlineOffset) };
    });
    expect(focusRing.outlineStyle, `${selector}: the focused article block must show an outline`).not.toBe("none");
    expect(focusRing.outlineWidth, `${selector}: the focus outline width must reach two pixels`).toBeGreaterThanOrEqual(2);
    // Keep the focus ring inside the block to prevent clipping at rounded corners.
    expect(focusRing.outlineOffset, `${selector}: the focus outline must stay inside the article block`).toBeLessThan(0);
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => scrollableBlock.evaluate((element) => element.scrollLeft), { message: `${selector}: the article block must scroll after ArrowRight` }).toBeGreaterThan(0);
  }
});

test("The last article control keeps its focus ring clear of the header and footer", async ({ page }) => {
  await page.setViewportSize(viewports.mobile);
  await useReducedMotion(page);
  await page.goto(draftOrigin + articlePath);
  await settle(page);
  const focusableSelector = "main :is(a[href], button:not([hidden]), [tabindex='0'])";
  expect(await tabTo(page, `${focusableSelector} >> nth=-1`, 80), "The last article control must accept keyboard focus").toBe(true);
  await expect.poll(async () => {
    const { ringBottom, fadeTop } = await focusRingAndFade(page);
    return fadeTop - ringBottom;
  }, { message: "The last article focus ring must stay above the footer fade" }).toBeGreaterThanOrEqual(0);
  const { ringTop } = await focusRingAndFade(page);
  expect(ringTop, "The last article focus ring must stay below the header").toBeGreaterThanOrEqual(
    await page.locator(".site-header").evaluate((header) => header.getBoundingClientRect().bottom - 1),
  );
});
