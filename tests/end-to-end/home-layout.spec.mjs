import { expect, test } from "@playwright/test";
import { expectReadablePage, pageProblems, paintedPixels, settle, useReducedMotion, VIEWPORTS as viewports } from "../shared/browser-fixtures.mjs";

const globeSelector = "[data-lyra-globe]";

// Desktop places the globe beside the introduction.
// Mobile stacks them and uses the navigation menu.
// The short viewport checks that the footer does not hide the final content.
for (const viewport of [viewports.desktop, viewports.mobile, { width: 360, height: 500 }]) {
  test(`Home shows readable content and a visible globe at ${viewport.width}px`, async ({ page }) => {
    const recordedPageProblems = pageProblems(page);
    await page.setViewportSize(viewport);
    await useReducedMotion(page);
    await page.goto("/");
    await settle(page);
    await expectReadablePage(page);
    await expect(page.locator(".hero__lede, .hero__thesis")).toHaveCount(2);
    await expect(page.locator(".hero__lede")).toBeVisible();
    await expect(page.locator(".hero__thesis")).toBeVisible();
    await expect(page.locator(globeSelector)).toHaveAttribute("data-ready", "true");
    await expect(page.locator(globeSelector)).toHaveAttribute("aria-hidden", "true");
    expect(await paintedPixels(page, globeSelector, 8), "The globe must contain more than 100 foreground pixels").toBeGreaterThan(100);
    const layout = await page.evaluate((selector) => {
      const globeRectangle = document.querySelector(selector).getBoundingClientRect();
      const introduction = document.querySelector(".hero__main").getBoundingClientRect();
      const globeRoot = document.querySelector(selector);
      return {
        globeClearOfIntroduction: globeRectangle.left >= introduction.right - 1 || globeRectangle.bottom <= introduction.top + 1,
        focusableControlCount: globeRoot.querySelectorAll("a, button, input, [tabindex]").length,
        pointerEvents: getComputedStyle(globeRoot).pointerEvents,
        titleClipped: document.querySelector("h1").scrollWidth > document.querySelector("h1").clientWidth,
      };
    }, globeSelector);
    expect(layout.globeClearOfIntroduction, "The globe must stay clear of the introduction").toBe(true);
    expect(layout.focusableControlCount).toBe(0);
    expect(layout.pointerEvents).toBe("none");
    expect(layout.titleClipped).toBe(false);
    await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
    expect(await page.locator(".hero__next").evaluate((list) =>
      list.getBoundingClientRect().bottom <= document.querySelector(".site-footer").getBoundingClientRect().top + 1,
    ), "The footer must stay below the home links").toBe(true);
    expect(recordedPageProblems).toEqual([]);
  });
}
