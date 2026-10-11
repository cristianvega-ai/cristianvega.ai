import { expect, test } from "@playwright/test";
import { DRAFT_ORIGIN as draftOrigin, pageProblems, settle, tabTo, useReducedMotion } from "../shared/browser-fixtures.mjs";

const articlePath = "/writing/full-article-layout-fixture/";

async function menuContrast(menuLink) {
  return menuLink.evaluate((element) => {
    const linkStyle = getComputedStyle(element);
    const panelBackgroundColor = getComputedStyle(element.closest(".navigation-menu__panel")).backgroundColor;
    const colorLuminance = (color) => {
      const channels = color.match(/[\d.]+/g).slice(0, 3).map((channelValue) => {
        const channel = Number(channelValue) / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const contrastRatio = (color) => {
      const textLuminance = colorLuminance(color);
      const backgroundLuminance = colorLuminance(panelBackgroundColor);
      return (Math.max(textLuminance, backgroundLuminance) + 0.05) / (Math.min(textLuminance, backgroundLuminance) + 0.05);
    };
    return {
      textContrast: contrastRatio(linkStyle.color),
      ringContrast: contrastRatio(linkStyle.outlineColor),
      ringStyle: linkStyle.outlineStyle,
      ringWidth: parseFloat(linkStyle.outlineWidth),
      focusVisible: element.matches(":focus-visible"),
    };
  });
}

test.beforeEach(async ({ page }, testInformation) => {
  testInformation.errorsOnPage = pageProblems(page);
  await useReducedMotion(page);
  await page.goto(new URL(articlePath, draftOrigin).href);
  await settle(page);
});

test.afterEach(async ({}, testInformation) => {
  expect(testInformation.errorsOnPage).toEqual([]);
});

for (const width of [360]) {
  test(`The article menu preserves text contrast and keyboard focus at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await settle(page);
    expect(await tabTo(page, ".navigation-menu__toggle")).toBe(true);
    await page.keyboard.press("Enter");
    const menuPanel = page.locator(".navigation-menu__panel");
    await expect(menuPanel).toBeVisible();

    const menuLinks = menuPanel.getByRole("link");
    const currentLink = menuPanel.locator("[aria-current]");
    await expect(currentLink).toHaveAttribute("aria-current", "location");
    for (const menuLink of await menuLinks.all()) {
      expect.soft((await menuContrast(menuLink)).textContrast, `${await menuLink.textContent()}: menu text must meet the contrast threshold without interaction`).toBeGreaterThanOrEqual(4.5);
    }

    const firstLink = menuLinks.first();
    await firstLink.hover();
    expect.soft((await menuContrast(firstLink)).textContrast, "Hovered menu text must meet the contrast threshold").toBeGreaterThanOrEqual(4.5);
    await page.mouse.move(0, 0);
    await page.keyboard.press("Tab");
    await expect(firstLink).toBeFocused();
    const focusedContrast = await menuContrast(firstLink);
    expect(focusedContrast.focusVisible).toBe(true);
    expect(focusedContrast.ringStyle).toBe("solid");
    expect(focusedContrast.ringWidth).toBeGreaterThanOrEqual(2);
    expect.soft(focusedContrast.textContrast, "Focused menu text must meet the contrast threshold").toBeGreaterThanOrEqual(4.5);
    expect.soft(focusedContrast.ringContrast, "The menu focus ring must meet the contrast threshold").toBeGreaterThanOrEqual(3);
    expect.soft((await menuContrast(currentLink)).textContrast, "The current menu link must meet the text contrast threshold").toBeGreaterThanOrEqual(4.5);
  });
}
