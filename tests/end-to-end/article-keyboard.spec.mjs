import { expect, test } from "@playwright/test";
import { DRAFT_ORIGIN as draftOrigin, readingStar, settle, tabTo, useReducedMotion, VIEWPORTS as viewports } from "../shared/browser-fixtures.mjs";

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

test("The reading star follows the skip link in the tab order and shows a focus ring", async ({ page }) => {
  await useReducedMotion(page);
  await page.goto(draftOrigin + articlePath);
  await settle(page);
  await page.keyboard.press("Tab");
  await expect(page.locator(".skip-link")).toBeFocused();
  await page.keyboard.press("Tab");
  const { link, label } = readingStar(page);
  await expect(link, "Reading star: it must be the first stop after the skip link").toBeFocused();
  const focusRing = await link.evaluate((element) => {
    const computedStyle = getComputedStyle(element);
    return { visible: element.matches(":focus-visible"), outlineStyle: computedStyle.outlineStyle, outlineWidth: parseFloat(computedStyle.outlineWidth) };
  });
  expect(focusRing.visible, "Reading star: keyboard focus must match focus-visible").toBe(true);
  expect(focusRing.outlineStyle, "Reading star: the focused star must show an outline").not.toBe("none");
  expect(focusRing.outlineWidth, "Reading star: the focus outline width must reach two pixels").toBeGreaterThanOrEqual(2);
  await expect(label, "Reading star: keyboard focus must open the label").toHaveCSS("opacity", "1");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(draftOrigin + "/writing/");
});

test("The pill star leaves the last article control and its focus ring uncovered", async ({ page }) => {
  await page.setViewportSize(viewports.mobile);
  await useReducedMotion(page);
  await page.goto(draftOrigin + articlePath);
  await settle(page);
  const focusableSelector = "main :is(a[href], button:not([hidden]), [tabindex='0']):not(.reading-star__link)";
  expect(await tabTo(page, `${focusableSelector} >> nth=-1`, 80), "The last article control must accept keyboard focus").toBe(true);
  await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
  await expect.poll(async () => {
    const { ring, pill } = await page.evaluate(() => {
      const focusedElement = document.activeElement;
      const focusStyle = getComputedStyle(focusedElement);
      const ringSize = parseFloat(focusStyle.outlineOffset) + parseFloat(focusStyle.outlineWidth);
      const focusedBox = focusedElement.getBoundingClientRect();
      const pillBox = document.querySelector(".reading-star__link").getBoundingClientRect();
      return {
        ring: { left: focusedBox.left - ringSize, right: focusedBox.right + ringSize, top: focusedBox.top - ringSize, bottom: focusedBox.bottom + ringSize },
        pill: { left: pillBox.left, right: pillBox.right, top: pillBox.top, bottom: pillBox.bottom },
      };
    });
    const overlapsHorizontally = ring.left < pill.right && ring.right > pill.left;
    const overlapsVertically = ring.top < pill.bottom && ring.bottom > pill.top;
    return overlapsHorizontally && overlapsVertically;
  }, { message: "The pill star must not cover the focus ring of the last article control" }).toBe(false);
});
