import { expect, test } from "@playwright/test";
import { DRAFT_ORIGIN, pageProblems, settle, tabTo, useReducedMotion, VIEWPORTS } from "./fixtures.mjs";

const article = "/writing/full-article-layout-fixture/";

async function menuContrast(link) {
  return link.evaluate((element) => {
    const style = getComputedStyle(element);
    const background = getComputedStyle(element.closest(".navigation-menu__panel")).backgroundColor;
    const luminance = (color) => {
      const channels = color.match(/[\d.]+/g).slice(0, 3).map((value) => {
        const channel = Number(value) / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const contrast = (color) => {
      const text = luminance(color);
      const surface = luminance(background);
      return (Math.max(text, surface) + 0.05) / (Math.min(text, surface) + 0.05);
    };
    return {
      text: contrast(style.color),
      ring: contrast(style.outlineColor),
      ringStyle: style.outlineStyle,
      ringWidth: parseFloat(style.outlineWidth),
      focusVisible: element.matches(":focus-visible"),
    };
  });
}

test.beforeEach(async ({ page }, testInformation) => {
  testInformation.errorsOnPage = pageProblems(page);
  await useReducedMotion(page);
  await page.goto(new URL(article, DRAFT_ORIGIN).href);
  await settle(page);
});

test.afterEach(async ({}, testInformation) => {
  expect(testInformation.errorsOnPage).toEqual([]);
});

for (const width of [360, 390, 640]) {
  test(`${width}px article menu keeps text and keyboard focus clear`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await settle(page);
    expect(await tabTo(page, ".navigation-menu__toggle")).toBe(true);
    await page.keyboard.press("Enter");
    const panel = page.locator(".navigation-menu__panel");
    await expect(panel).toBeVisible();
    await expect.soft(panel).toHaveCSS("background-color", "rgb(26, 32, 41)");

    const links = panel.getByRole("link");
    const current = panel.locator("[aria-current]");
    await expect(current).toHaveAttribute("aria-current", "location");
    for (const link of await links.all()) {
      expect.soft((await menuContrast(link)).text, `normal ${await link.textContent()} text`).toBeGreaterThanOrEqual(4.5);
    }

    const first = links.first();
    await first.hover();
    await expect(first).toHaveCSS("color", "rgb(234, 237, 242)");
    expect.soft((await menuContrast(first)).text, "hover text").toBeGreaterThanOrEqual(4.5);
    await page.mouse.move(0, 0);
    await expect(first).toHaveCSS("color", "rgb(152, 161, 176)");
    await page.keyboard.press("Tab");
    await expect(first).toBeFocused();
    await expect(first).toHaveCSS("outline-color", "rgb(56, 189, 248)");
    const focused = await menuContrast(first);
    expect(focused.focusVisible).toBe(true);
    expect(focused.ringStyle).toBe("solid");
    expect(focused.ringWidth).toBeGreaterThanOrEqual(2);
    expect.soft(focused.text, "focus text").toBeGreaterThanOrEqual(4.5);
    expect.soft(focused.ring, "focus ring").toBeGreaterThanOrEqual(3);
    expect.soft((await menuContrast(current)).text, "current text").toBeGreaterThanOrEqual(4.5);
  });
}

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test(`${name} article prose keeps its light text color`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await settle(page);
    await expect(page.locator(".prose > p").first()).toHaveCSS("color", "rgb(197, 205, 217)");
    await expect(page.locator(".principles li").first()).toHaveCSS("color", "rgb(197, 205, 217)");
  });
}
