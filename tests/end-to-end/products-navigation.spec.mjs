import { expect, test } from "@playwright/test";
import { currentContent, currentPublished, DRAFT_ORIGIN as draftOrigin, expectReadablePage, pageProblems, readingStar, settle, VIEWPORTS as viewports } from "../shared/browser-fixtures.mjs";

// Check the product list and product page at a wide and a narrow width.
for (const viewport of [viewports.desktop, viewports.mobile]) {
  test(`Products opens a product page and returns to the list at ${viewport.width}px`, async ({ page }) => {
    const recordedPageProblems = pageProblems(page);
    await page.setViewportSize(viewport);
    await page.goto(draftOrigin + "/products/");
    await settle(page);
    await expectReadablePage(page);
    await expect(page.locator("main h1")).toHaveText("Products");
    await expect(page.locator("a.entry-row")).toHaveCount(currentContent.products.length);
    expect(await page.locator("a.entry-row").evaluateAll((links) => links.map((link) => link.getAttribute("href"))), "Products: the list must show the newest product first")
      .toEqual(currentContent.products.map((productEntry) => productEntry.href));
    const product = currentContent.products.find((productEntry) => productEntry.id === "product-layout-fixture");
    expect(product, "The product navigation check must find its content fixture").toBeDefined();
    await expect(page.locator(`a.entry-row[href='${product.href}'] .entry-row__description`)).toHaveText(product.data.description);
    await page.getByRole("link", { name: product.data.title }).click();
    await expect(page).toHaveURL(draftOrigin + product.href);
    await settle(page);
    await expectReadablePage(page);
    await expect(page.locator("main h1")).toHaveText(product.data.title);
    await expect(page.locator(".detail__meta")).toHaveText(product.data.status);
    await expect(page.locator(".prose")).toContainText("Lorem ipsum dolor sit amet");
    if (product.data.draft) await expect(page.locator("meta[name='robots']")).toHaveAttribute("content", "noindex, follow");
    const outboundLink = page.locator("a.product__link[target='_blank']");
    if (product.data.url) {
      await expect(outboundLink).toHaveAttribute("href", product.data.url);
      await expect(outboundLink).toHaveAttribute("rel", "noopener noreferrer");
      await expect(outboundLink).toHaveText(`Visit ${product.data.title} ↗`);
    } else await expect(outboundLink).toHaveCount(0);
    await expect(readingStar(page).label).toHaveText("Products");
    await readingStar(page).link.click();
    await expect(page.locator("main h1")).toHaveText("Products");
    expect(recordedPageProblems).toEqual([]);
  });
}

test("Production hides product drafts and unknown product routes", async ({ request }) => {
  for (const productEntry of currentContent.products) {
    expect((await request.get(productEntry.href)).status(), productEntry.href).toBe(productEntry.data.draft ? 404 : 200);
  }
  expect((await request.get("/products/")).status()).toBe(currentPublished.products.length ? 200 : 404);
  expect((await request.get(draftOrigin + "/products/no-such-product/")).status()).toBe(404);
});
