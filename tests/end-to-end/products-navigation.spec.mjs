import { expect, test } from "@playwright/test";
import { currentContent, currentPublished, DRAFT_ORIGIN as draftOrigin, expectReadablePage, pageProblems, settle, VIEWPORTS as viewports } from "../shared/browser-fixtures.mjs";

// Check the product list and product page in both navigation layouts.
for (const viewport of [viewports.desktop, viewports.mobile]) {
  test(`Products opens a product page and returns to the list at ${viewport.width}px`, async ({ page }) => {
    const recordedPageProblems = pageProblems(page);
    await page.setViewportSize(viewport);
    await page.goto(draftOrigin + "/products/");
    await settle(page);
    await expectReadablePage(page);
    await expect(page.locator("main h1")).toHaveText("Products");
    const productCount = await page.locator("[data-product-identifier]").count();
    expect(productCount, "The draft product list must contain at least one product").toBeGreaterThan(0);
    await expect(page.locator("[data-graphic='products']")).toHaveAttribute("data-products", String(productCount));
    const product = currentContent.products.find((productEntry) => productEntry.id === "product-layout-fixture");
    expect(product, "The product navigation check must find its content fixture").toBeDefined();
    await page.getByRole("link", { name: product.data.title, exact: true }).click();
    await expect(page).toHaveURL(draftOrigin + product.href);
    await settle(page);
    await expectReadablePage(page);
    await expect(page.locator("main h1")).toHaveText(product.data.title);
    await expect(page.locator(".product__prose")).toContainText("Lorem ipsum dolor sit amet");
    await expect(page.locator("[data-graphic='products']")).toHaveAttribute("data-current", String(currentContent.products.indexOf(product)));
    if (product.data.draft) await expect(page.locator("meta[name='robots']")).toHaveAttribute("content", "noindex, follow");
    const outboundLink = page.locator(".product__link[target='_blank']");
    if (product.data.url) {
      await expect(outboundLink).toHaveAttribute("href", product.data.url);
      await expect(outboundLink).toHaveAttribute("rel", "noopener noreferrer");
    } else await expect(outboundLink).toHaveCount(0);
    await page.getByRole("link", { name: "All products →" }).click();
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
