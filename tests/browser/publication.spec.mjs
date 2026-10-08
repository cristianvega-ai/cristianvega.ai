import { expect } from "@playwright/test";
import { permissionsPolicy, publishedContent } from "../helpers.mjs";
import { contentSecurityPolicyViolations, latestWork, navigationLink, pageProblems, publicationTest as test, recordContentSecurityPolicyViolations, settle, tabTo, useReducedMotion, VIEWPORTS } from "./fixtures.mjs";

function expectProductionHeaders(headers) {
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["permissions-policy"]).toBe(permissionsPolicy);
  expect(headers["strict-transport-security"]).toBe("max-age=31536000");
  expect(headers["content-security-policy"]).toContain("script-src 'self'");
  expect(headers["content-security-policy"]).toContain("style-src-attr 'none'");
  expect(headers["cache-control"]).toContain("must-revalidate");
}

test.describe("mixed published content in the production runtime", () => {
  test.describe.configure({ mode: "default" });

  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    test(`${name} opens published writing and products with working scripts`, async ({ page, publication }) => {
      const errors = pageProblems(page, ["error", "warning"]);
      await recordContentSecurityPolicyViolations(page);
      await page.addInitScript(() => {
        window.__publicationCopies = [];
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
          async writeText(text) { window.__publicationCopies.push(text); },
        } });
      });
      await page.setViewportSize(viewport);
      await useReducedMotion(page);
      const response = await page.goto(publication.origin);
      expect(response.status()).toBe(200);
      expectProductionHeaders(response.headers());
      await settle(page);
      await expect(page.locator(".hero__next-item")).toHaveText(latestWork.map((item) => `${item.label} →`));
      await expect(page.locator(".hero__next a")).toHaveCount(2);
      await expect(page.locator(".hero__next-soon, [data-article-identifier], [data-product-identifier]")).toHaveCount(0);
      await expect(page.locator("[data-lyra-globe]")).toHaveAttribute("data-ready", "true");

      const published = publishedContent(publication.inventory);
      expect(published.writing.map((entry) => entry.id)).toEqual(["newer-writing", "alpha-tied", "zulu-tied"]);
      expect(published.products.map((entry) => entry.id)).toEqual(["default-order", "alpha-product", "zulu-product"]);
      await navigationLink(page, "writing").click();
      await expect(page.locator(".navigation__link[href='/writing/']")).toHaveAttribute("aria-current", "page");
      await expect(page.locator("meta[name='robots'], .draft-label")).toHaveCount(0);
      await expect(page.locator("[data-graphic='writing']")).toHaveAttribute("data-ready", "true");
      expect(await page.locator(".article-list__item").evaluateAll((rows) => rows.map((row) => row.dataset.articleIdentifier)))
        .toEqual(published.writing.map((entry) => entry.id));
      expect(await page.locator(".article-list__link").evaluateAll((links) => links.map((link) => link.getAttribute("href"))))
        .toEqual(published.writing.map((entry) => entry.href));
      expect(await tabTo(page, ".article-list__link >> nth=1")).toBe(true);
      await expect(page.locator("[data-graphic='writing']")).toHaveAttribute("data-active-article", "alpha-tied");
      await page.keyboard.press("Enter");
      const article = published.writing[1];
      await expect(page).toHaveURL(publication.origin + article.href);
      await expect(page.locator("#article-title")).toHaveText(article.data.title);
      await expect(page.locator(".article__description")).toHaveText(article.data.description);
      await expect(page.locator(".article__draft, .draft-label, meta[name='robots']")).toHaveCount(0);
      await expect(page.locator(".navigation__link[href='/writing/']")).toHaveAttribute("aria-current", "location");
      await expect(page.locator("link[rel='canonical']")).toHaveAttribute("href", `https://cristianvega.ai${article.href}`);
      await expect(page.locator("meta[property='article:published_time']")).toHaveAttribute("content", article.data.date.toISOString());
      await expect(page.locator(".prose")).toContainText(`Body for ${article.id}.`);
      await expect(page.locator(".prose pre")).toHaveAttribute("aria-label", "Code example");
      await expect(page.locator(".figure__panel")).toHaveAttribute("aria-label", "Fixture signal path");
      await expect(page.locator(".figure__panel")).toHaveAttribute("role", "img");
      await expect(page.locator(".author__share a")).toHaveCount(2);
      for (const link of await page.locator(".author__share a").all()) {
        await expect(link).toHaveAttribute("rel", "noopener noreferrer");
      }
      await page.getByRole("button", { name: "copy link" }).click();
      await expect(page.locator(".share-status")).toHaveText("Link copied.");
      expect(await page.evaluate(() => window.__publicationCopies)).toEqual([`https://cristianvega.ai${article.href}`]);
      expect(await page.locator(".read-next a").evaluateAll((links) => links.map((link) => link.getAttribute("href"))))
        .toEqual([published.writing[2].href, published.writing[0].href]);
      await page.getByRole("link", { name: /Older/ }).click();
      await expect(page.locator("#article-title")).toHaveText(published.writing[2].data.title);

      await navigationLink(page, "products").click();
      await expect(page.locator(".navigation__link[href='/products/']")).toHaveAttribute("aria-current", "page");
      await expect(page.locator("meta[name='robots'], .draft-label")).toHaveCount(0);
      await expect(page.locator("[data-graphic='products']")).toHaveAttribute("data-ready", "true");
      expect(await page.locator(".entries__item").evaluateAll((rows) => rows.map((row) => row.dataset.productIdentifier)))
        .toEqual(published.products.map((entry) => entry.id));
      for (const product of published.products) {
        await page.getByRole("link", { name: product.data.title, exact: true }).click();
        await expect(page.locator("#product-title")).toHaveText(product.data.title);
        await expect(page.locator(".product__lede")).toHaveText(product.data.description);
        await expect(page.locator(".product__header .eyebrow")).toHaveText(product.data.status);
        await expect(page.locator(".product__prose")).toContainText(`Body for ${product.id}.`);
        await expect(page.locator(".navigation__link[href='/products/']")).toHaveAttribute("aria-current", "location");
        await expect(page.locator("meta[name='robots'], .draft-label")).toHaveCount(0);
        await expect(page.locator("link[rel='canonical']")).toHaveAttribute("href", `https://cristianvega.ai${product.href}`);
        await expect(page.locator("[data-graphic='products']")).toHaveAttribute("data-ready", "true");
        const outbound = page.locator(".product__link[target='_blank']");
        if (product.data.url) {
          await expect(outbound).toHaveAttribute("href", product.data.url);
          await expect(outbound).toHaveAttribute("rel", "noopener noreferrer");
        } else await expect(outbound).toHaveCount(0);
        expect(await contentSecurityPolicyViolations(page)).toEqual([]);
        await page.getByRole("link", { name: "All products →" }).click();
      }
      expect(await contentSecurityPolicyViolations(page)).toEqual([]);
      expect(errors).toEqual([]);
    });
  }

  test("production routes and sitemap exclude explicit and default drafts", async ({ request, publication }) => {
    const published = publishedContent(publication.inventory);
    const expected = ["/", "/about/", "/writing/", "/products/", ...Object.values(published).flat().map((entry) => entry.href)].sort();
    const sitemap = await request.get(`${publication.origin}/sitemap-0.xml`);
    expect(sitemap.status()).toBe(200);
    const paths = [...(await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, location]) => new URL(location).pathname).sort();
    expect(paths).toEqual(expected);
    for (const entries of Object.values(publication.inventory)) {
      for (const draft of entries.filter((entry) => entry.data.draft)) {
        const response = await request.get(publication.origin + draft.href);
        expect(response.status(), draft.href).toBe(404);
        expectProductionHeaders(response.headers());
        expect(await response.text()).toContain("Page not found");
        expect(paths).not.toContain(draft.href);
      }
    }
  });

  test("published pages use noindex only on the Cloudflare preview host", async ({ request, publication }) => {
    const published = publishedContent(publication.inventory);
    const paths = ["/", "/writing/", "/products/", ...Object.values(published).flat().map((entry) => entry.href)];
    for (const path of paths) {
      for (const [host, robots] of [["cristianvega.ai", undefined], ["cristianvega-ai.preview.workers.dev", "noindex"]]) {
        const response = await request.get(publication.origin + path, { headers: { host } });
        expect(response.status(), path).toBe(200);
        expectProductionHeaders(response.headers());
        expect(response.headers()["x-robots-tag"], `${host}${path}`).toBe(robots);
        expect(await response.text()).not.toMatch(/name="robots" content="noindex/);
      }
    }
  });

  // The share block exists only on a published article, so the copy checks use the real markup here.
  for (const fails of [false, true]) {
    test(`a published article copies its link and reports ${fails ? "a failure" : "success"} in its own status`, async ({ page, publication }) => {
      const errors = pageProblems(page);
      await page.addInitScript((fails) => {
        window.__copiedLinks = [];
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
          async writeText(text) {
            window.__copiedLinks.push(text);
            if (fails) throw new Error("Clipboard blocked");
          },
        } });
      }, fails);
      const article = publishedContent(publication.inventory).writing[0];
      await page.goto(publication.origin + article.href);
      // A status before the article comes first in the document. The copy result must not reach it.
      await page.locator(".article").evaluate((article) => article.insertAdjacentHTML("beforebegin",
        '<span id="outside-status" class="share-status" role="status">Outside status</span>'));
      const button = page.getByRole("button", { name: "copy link" });
      await expect(button).toBeVisible();
      await button.click();
      await expect(page.locator(".article .share-status")).toHaveText(fails
        ? "Copy the address from your browser to share this post."
        : "Link copied.");
      await expect(page.locator("#outside-status")).toHaveText("Outside status");
      expect(await page.evaluate(() => window.__copiedLinks)).toEqual([`https://cristianvega.ai${article.href}`]);
      expect(errors).toEqual([]);
    });
  }

  test("a published article keeps its copy button hidden without a clipboard", async ({ page, publication }) => {
    const errors = pageProblems(page);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    });
    const article = publishedContent(publication.inventory).writing[0];
    await page.goto(publication.origin + article.href);
    await expect(page.getByRole("link", { name: "Share on LinkedIn" })).toBeVisible();
    await expect(page.getByRole("button", { name: "copy link", includeHidden: true })).toBeHidden();
    await expect(page.locator(".article .share-status")).toBeEmpty();
    expect(errors).toEqual([]);
  });

  test("published content and navigation work without JavaScript", async ({ browser, publication }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: VIEWPORTS.mobile });
    try {
      const page = await context.newPage();
      await page.goto(publication.origin);
      await page.getByRole("link", { name: "Read my latest writing", exact: true }).click();
      await expect(page.locator("[data-graphic='writing']")).toBeHidden();
      await page.getByRole("link", { name: "Alpha tied writing", exact: true }).click();
      await expect(page.locator(".prose")).toContainText("Body for alpha-tied.");
      await expect(page.getByRole("button", { name: "copy link" })).toBeHidden();
      await expect(page.getByRole("link", { name: "Share on LinkedIn" })).toBeVisible();
      await navigationLink(page, "products").click();
      await page.getByRole("link", { name: "Alpha product", exact: true }).click();
      await expect(page.locator(".product__prose")).toContainText("Body for alpha-product.");
      const product = publishedContent(publication.inventory).products.find((entry) => entry.id === "alpha-product");
      await expect(page.locator(".product__link[target='_blank']")).toHaveAttribute("href", product.data.url);
    } finally {
      await context.close();
    }
  });
});
