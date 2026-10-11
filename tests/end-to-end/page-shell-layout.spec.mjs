import { expect, test } from "@playwright/test";
import { DRAFT_ORIGIN as draftOrigin, expectReadablePage, settle, VIEWPORTS as viewports } from "../shared/browser-fixtures.mjs";

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
