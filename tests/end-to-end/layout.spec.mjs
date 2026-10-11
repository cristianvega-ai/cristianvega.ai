import { expect, test } from "@playwright/test";
import { headerLinks } from "../shared/node-helpers.mjs";
import { currentContent, currentPublished, DRAFT_ORIGIN as draftOrigin, expectReadablePage, settle, tabTo, VIEWPORTS as viewports } from "../shared/browser-fixtures.mjs";

// Check the shared shell on one long page and one short page in both layouts.
for (const viewport of [viewports.desktop, viewports.mobile]) {
  test(`The page shell preserves readable content and footer at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    for (const pageAddress of ["/about/", "/missing-layout-check/"]) {
      await page.goto(pageAddress);
      await settle(page);
      await expectReadablePage(page);
      await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
      const shellLayout = await page.evaluate(() => {
        const footerRectangle = document.querySelector(".site-footer").getBoundingClientRect();
        const contentRectangle = document.querySelector("#main-content").getBoundingClientRect();
        const disclaimerElement = document.querySelector(".site-footer__disclaimer");
        return {
          contentFooterGap: footerRectangle.top - contentRectangle.bottom,
          footerInsideViewport: footerRectangle.left >= 0 && footerRectangle.right <= document.documentElement.clientWidth + 1,
          disclaimerClipped: disclaimerElement.scrollWidth > disclaimerElement.clientWidth,
        };
      });
      expect(shellLayout.contentFooterGap, `${pageAddress}: the footer must stay below the main content`).toBeGreaterThanOrEqual(0);
      expect(shellLayout.footerInsideViewport, `${pageAddress}: the footer must stay inside the viewport`).toBe(true);
      expect(shellLayout.disclaimerClipped, `${pageAddress}: the footer disclaimer must have no horizontal clipping`).toBe(false);
    }
  });
}

// Check both sides of the menu breakpoint and the minimum inline navigation width.
for (const width of [360, 640, 641]) {
  test(`The header exposes every navigation link at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(draftOrigin + "/");
    await settle(page);
    await expectReadablePage(page);
    const menuToggle = page.locator(".navigation-menu__toggle");
    if (width <= 640) {
      await expect(menuToggle).toBeVisible();
      await menuToggle.click();
      await expect(page.locator(".navigation-menu__panel")).toBeVisible();
    } else await expect(menuToggle).toBeHidden();
    const navigationLinks = page.locator(".navigation:visible, .navigation-menu__panel:visible").getByRole("link");
    const expectedHeaderLinks = headerLinks(Object.fromEntries(Object.entries(currentContent).map(([section, entries]) => [section, entries.map((entry) => ({ ...entry, data: { ...entry.data, draft: false } }))])));
    await expect(navigationLinks).toHaveCount(6);
    expect(await navigationLinks.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")))).toEqual(expectedHeaderLinks.map((link) => link.href));
    for (const link of await navigationLinks.all()) {
      await expect(link).toBeVisible();
      const linkRectangle = await link.boundingBox();
      expect(linkRectangle.x, "The navigation link must stay inside the viewport left edge").toBeGreaterThanOrEqual(0);
      expect(linkRectangle.x + linkRectangle.width, "The navigation link must stay inside the viewport right edge").toBeLessThanOrEqual(width + 1);
      expect(linkRectangle.height, "The navigation link height must meet the viewport target size").toBeGreaterThanOrEqual(width <= 640 ? 44 : 40);
    }
  });
}

test("The compact menu opens, closes, and returns keyboard focus", async ({ page }) => {
  await page.setViewportSize(viewports.mobile);
  await page.goto("/");
  await settle(page);
  expect(await tabTo(page, ".navigation-menu__toggle")).toBe(true);
  const menuToggle = page.locator(".navigation-menu__toggle");
  expect(await menuToggle.evaluate((element) => {
    const toggleStyle = getComputedStyle(element);
    return element.matches(":focus-visible") && toggleStyle.outlineStyle !== "none" && parseFloat(toggleStyle.outlineWidth) >= 2;
  }), "The menu button must show a visible keyboard focus ring").toBe(true);
  const menuPanel = page.locator(".navigation-menu__panel");
  await page.keyboard.press("Enter");
  await expect(menuPanel).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(menuPanel.getByRole("link").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menuPanel).toBeHidden();
  await expect(menuToggle).toBeFocused();
  await page.keyboard.press("Space");
  await expect(menuPanel).toBeVisible();
  await menuPanel.getByRole("link").last().focus();
  await page.keyboard.press("Tab");
  await expect(menuPanel).toBeHidden();
});

test("The compact menu closes after outside clicks and follows its links", async ({ page }) => {
  await page.setViewportSize(viewports.mobile);
  await page.goto("/");
  const menuToggle = page.locator(".navigation-menu__toggle");
  await menuToggle.click();
  await expect(page.locator(".navigation-menu__panel")).toBeVisible();
  await page.locator(".navigation-menu__rule").click({ force: true });
  await expect(page.locator(".navigation-menu__panel")).toBeVisible();
  await page.mouse.click(20, 500);
  await expect(page.locator(".navigation-menu__panel")).toBeHidden();
  await menuToggle.click();
  await page.locator(".navigation-menu__panel").getByRole("link", { name: "about", exact: true }).click();
  await expect(page).toHaveURL(/\/about\/$/);
});

test("The skip link moves keyboard focus to main content", async ({ page }) => {
  await page.goto("/about/");
  await page.keyboard.press("Tab");
  await expect(page.locator(".skip-link")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
});

test("The sticky header keeps article anchors visible after scrolling", async ({ page }) => {
  await page.setViewportSize(viewports.mobile);
  await page.goto(draftOrigin + "/writing/full-article-layout-fixture/");
  await settle(page);
  await page.locator(".prose h2").first().evaluate((heading) => heading.scrollIntoView({ behavior: "instant" }));
  await expect.poll(() => page.evaluate(() => {
    const headerRectangle = document.querySelector(".site-header").getBoundingClientRect();
    const heading = document.querySelector(".prose h2").getBoundingClientRect();
    return headerRectangle.top >= -1 && heading.top >= headerRectangle.bottom - 1;
  }), { message: "The article anchor must stay below the sticky header" }).toBe(true);
});

test("The compact menu exposes published sections without JavaScript", async ({ browser, baseURL: baseAddress }) => {
    const browserContext = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 800 } });
    const page = await browserContext.newPage();
    await page.goto(new URL("/", baseAddress).href);
    await page.locator(".navigation-menu__toggle").click();
    const publishedSectionCount = Object.values(currentPublished).filter((entries) => entries.length > 0).length;
    await expect(page.locator(".navigation-menu__panel").getByRole("link")).toHaveCount(4 + publishedSectionCount);
    await browserContext.close();
  });
