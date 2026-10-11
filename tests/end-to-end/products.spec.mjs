import { expect, test } from "@playwright/test";
import { currentContent, currentPublished, DRAFT_ORIGIN, expectReadablePage, pageProblems, settle, VIEWPORTS } from "../support/browser-fixtures.mjs";

// The index and detail use separate page adapters in both layout branches.
for (const viewport of [VIEWPORTS.desktop, VIEWPORTS.mobile]) {
  test(`products opens a detail and returns to the list at ${viewport.width}px`, async ({ page }) => {
    const problems = pageProblems(page);
    await page.setViewportSize(viewport);
    await page.goto(DRAFT_ORIGIN + "/products/");
    await settle(page);
    await expectReadablePage(page);
    await expect(page.locator("main h1")).toHaveText("Products");
    const listed = await page.locator("[data-product-identifier]").count();
    expect(listed, "the preview contains products").toBeGreaterThan(0);
    await expect(page.locator("[data-graphic='products']")).toHaveAttribute("data-products", String(listed));
    const product = currentContent.products.find((entry) => entry.id === "product-layout-fixture");
    expect(product, "the product flow requires its content fixture").toBeDefined();
    await page.getByRole("link", { name: product.data.title, exact: true }).click();
    await expect(page).toHaveURL(DRAFT_ORIGIN + product.href);
    await settle(page);
    await expectReadablePage(page);
    await expect(page.locator("main h1")).toHaveText(product.data.title);
    await expect(page.locator(".product__prose")).toContainText("Lorem ipsum dolor sit amet");
    await expect(page.locator("[data-graphic='products']")).toHaveAttribute("data-current", String(currentContent.products.indexOf(product)));
    if (product.data.draft) await expect(page.locator("meta[name='robots']")).toHaveAttribute("content", "noindex, follow");
    const outbound = page.locator(".product__link[target='_blank']");
    if (product.data.url) {
      await expect(outbound).toHaveAttribute("href", product.data.url);
      await expect(outbound).toHaveAttribute("rel", "noopener noreferrer");
    } else await expect(outbound).toHaveCount(0);
    await page.getByRole("link", { name: "All products →" }).click();
    await expect(page.locator("main h1")).toHaveText("Products");
    expect(problems).toEqual([]);
  });
}

test("production excludes product drafts and unknown product routes", async ({ request }) => {
  for (const entry of currentContent.products) {
    expect((await request.get(entry.href)).status(), entry.href).toBe(entry.data.draft ? 404 : 200);
  }
  expect((await request.get("/products/")).status()).toBe(currentPublished.products.length ? 200 : 404);
  expect((await request.get(DRAFT_ORIGIN + "/products/no-such-product/")).status()).toBe(404);
});
