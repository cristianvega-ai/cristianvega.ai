import { expect, test } from "@playwright/test";
import { headerLinks } from "../shared/helpers.mjs";
import { currentContent, currentPublished, DRAFT_ORIGIN, expectReadablePage, settle, tabTo, VIEWPORTS } from "../shared/browser-fixtures.mjs";

// Check the shared shell on one long page and one short page in both layouts.
for (const viewport of [VIEWPORTS.desktop, VIEWPORTS.mobile]) {
  test(`the shell keeps content and footer readable at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    for (const address of ["/about/", "/missing-layout-check/"]) {
      await page.goto(address);
      await settle(page);
      await expectReadablePage(page);
      await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
      const state = await page.evaluate(() => {
        const footer = document.querySelector(".site-footer").getBoundingClientRect();
        const content = document.querySelector("#main-content").getBoundingClientRect();
        const disclaimer = document.querySelector(".site-footer__disclaimer");
        return {
          contentClear: footer.top - content.bottom,
          footerInside: footer.left >= 0 && footer.right <= document.documentElement.clientWidth + 1,
          disclaimerClipped: disclaimer.scrollWidth > disclaimer.clientWidth,
        };
      });
      expect(state.contentClear, `${address}: the footer must not cover content`).toBeGreaterThanOrEqual(0);
      expect(state.footerInside, `${address}: the footer stays inside the viewport`).toBe(true);
      expect(state.disclaimerClipped, `${address}: the disclaimer must remain readable`).toBe(false);
    }
  });
}

// These widths protect the menu switch and the narrowest inline draft navigation.
for (const width of [360, 640, 641]) {
  test(`the header reaches every link at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(DRAFT_ORIGIN + "/");
    await settle(page);
    await expectReadablePage(page);
    const toggle = page.locator(".navigation-menu__toggle");
    if (width <= 640) {
      await expect(toggle).toBeVisible();
      await toggle.click();
      await expect(page.locator(".navigation-menu__panel")).toBeVisible();
    } else await expect(toggle).toBeHidden();
    const links = page.locator(".navigation:visible, .navigation-menu__panel:visible").getByRole("link");
    const expected = headerLinks(Object.fromEntries(Object.entries(currentContent).map(([section, entries]) => [section, entries.map((entry) => ({ ...entry, data: { ...entry.data, draft: false } }))])));
    await expect(links).toHaveCount(6);
    expect(await links.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")))).toEqual(expected.map((link) => link.href));
    for (const link of await links.all()) {
      await expect(link).toBeVisible();
      const box = await link.boundingBox();
      expect(box.x, "the navigation link stays inside the left edge").toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, "the navigation link stays inside the right edge").toBeLessThanOrEqual(width + 1);
      expect(box.height, "the navigation target remains usable").toBeGreaterThanOrEqual(width <= 640 ? 44 : 40);
    }
  });
}

test("the compact menu opens, closes, and returns keyboard focus", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.mobile);
  await page.goto("/");
  await settle(page);
  expect(await tabTo(page, ".navigation-menu__toggle")).toBe(true);
  const toggle = page.locator(".navigation-menu__toggle");
  expect(await toggle.evaluate((element) => {
    const style = getComputedStyle(element);
    return element.matches(":focus-visible") && style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2;
  }), "the menu button must show keyboard focus").toBe(true);
  const panel = page.locator(".navigation-menu__panel");
  await page.keyboard.press("Enter");
  await expect(panel).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(panel.getByRole("link").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(toggle).toBeFocused();
  await page.keyboard.press("Space");
  await expect(panel).toBeVisible();
  await panel.getByRole("link").last().focus();
  await page.keyboard.press("Tab");
  await expect(panel).toBeHidden();
});

test("the compact menu closes outside and follows its links", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.mobile);
  await page.goto("/");
  const toggle = page.locator(".navigation-menu__toggle");
  await toggle.click();
  await expect(page.locator(".navigation-menu__panel")).toBeVisible();
  await page.locator(".navigation-menu__rule").click({ force: true });
  await expect(page.locator(".navigation-menu__panel")).toBeVisible();
  await page.mouse.click(20, 500);
  await expect(page.locator(".navigation-menu__panel")).toBeHidden();
  await toggle.click();
  await page.locator(".navigation-menu__panel").getByRole("link", { name: "about", exact: true }).click();
  await expect(page).toHaveURL(/\/about\/$/);
});

test("skip navigation reaches the main content", async ({ page }) => {
  await page.goto("/about/");
  await page.keyboard.press("Tab");
  await expect(page.locator(".skip-link")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
});

test("the sticky header keeps article anchors readable", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.mobile);
  await page.goto(DRAFT_ORIGIN + "/writing/full-article-layout-fixture/");
  await settle(page);
  await page.locator(".prose h2").first().evaluate((heading) => heading.scrollIntoView({ behavior: "instant" }));
  await expect.poll(() => page.evaluate(() => {
    const header = document.querySelector(".site-header").getBoundingClientRect();
    const heading = document.querySelector(".prose h2").getBoundingClientRect();
    return header.top >= -1 && heading.top >= header.bottom - 1;
  }), { message: "the sticky header must not cover the article anchor" }).toBe(true);
});

test("works without JavaScript", async ({ browser, baseURL: baseAddress }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 800 } });
    const page = await context.newPage();
    await page.goto(new URL("/", baseAddress).href);
    await page.locator(".navigation-menu__toggle").click();
    const sections = Object.values(currentPublished).filter((entries) => entries.length > 0).length;
    await expect(page.locator(".navigation-menu__panel").getByRole("link")).toHaveCount(4 + sections);
    await context.close();
  });
