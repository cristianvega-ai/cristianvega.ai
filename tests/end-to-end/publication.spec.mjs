import { expect } from "@playwright/test";
import { permissionsPolicy, publishedContent } from "../shared/node-helpers.mjs";
import { contentSecurityPolicyViolations, latestWork, navigationLink, pageProblems, publicationTest as test, recordContentSecurityPolicyViolations, settle, tabTo, useReducedMotion, VIEWPORTS as viewports } from "../shared/browser-fixtures.mjs";

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

test.describe("Mixed published content in the production runtime", () => {
  test.describe.configure({ mode: "default" });

  for (const [viewportName, viewport] of Object.entries({ desktop: viewports.desktop, mobile: viewports.mobile })) {
    test(`Published writing and products provide navigation and scripts in the ${viewportName} viewport`, async ({ page, publication }) => {
      const recordedPageProblems = pageProblems(page, ["error", "warning"]);
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

      const publishedInventory = publishedContent(publication.inventory);
      await navigationLink(page, "writing").click();
      await expect(page.locator(".navigation__link[href='/writing/']")).toHaveAttribute("aria-current", "page");
      await expect(page.locator("meta[name='robots'], .draft-label")).toHaveCount(0);
      await expect(page.locator("[data-graphic='writing']")).toHaveAttribute("data-ready", "true");
      expect(await page.locator(".article-list__item").evaluateAll((rows) => rows.map((row) => row.dataset.articleIdentifier)))
        .toEqual(publishedInventory.writing.map((entry) => entry.id));
      expect(await page.locator(".article-list__link").evaluateAll((links) => links.map((link) => link.getAttribute("href"))))
        .toEqual(publishedInventory.writing.map((entry) => entry.href));
      expect(await tabTo(page, ".article-list__link >> nth=1")).toBe(true);
      await expect(page.locator("[data-graphic='writing']")).toHaveAttribute("data-active-article", "alpha-tied");
      await page.keyboard.press("Enter");
      const publishedArticle = publishedInventory.writing[1];
      await expect(page).toHaveURL(publication.origin + publishedArticle.href);
      await expect(page.locator("#article-title")).toHaveText(publishedArticle.data.title);
      await expect(page.locator(".article__description")).toHaveText(publishedArticle.data.description);
      await expect(page.locator(".article__draft, .draft-label, meta[name='robots']")).toHaveCount(0);
      await expect(page.locator(".navigation__link[href='/writing/']")).toHaveAttribute("aria-current", "location");
      await expect(page.locator("link[rel='canonical']")).toHaveAttribute("href", `https://cristianvega.ai${publishedArticle.href}`);
      await expect(page.locator("meta[property='article:published_time']")).toHaveAttribute("content", publishedArticle.data.date.toISOString());
      await expect(page.locator(".prose")).toContainText(`Body for ${publishedArticle.id}.`);
      await expect(page.locator(".prose pre")).toHaveAttribute("aria-label", "Code example");
      await expect(page.locator(".figure__panel")).toHaveAttribute("aria-label", "Fixture signal path");
      await expect(page.locator(".figure__panel")).toHaveAttribute("role", "img");
      await expect(page.locator(".author__share a")).toHaveCount(2);
      for (const link of await page.locator(".author__share a").all()) {
        await expect(link).toHaveAttribute("rel", "noopener noreferrer");
      }
      await page.getByRole("button", { name: "copy link" }).click();
      await expect(page.locator(".share-status")).toHaveText("Link copied.");
      expect(await page.evaluate(() => window.__publicationCopies)).toEqual([`https://cristianvega.ai${publishedArticle.href}`]);
      expect(await page.locator(".read-next a").evaluateAll((links) => links.map((link) => link.getAttribute("href"))))
        .toEqual([publishedInventory.writing[2].href, publishedInventory.writing[0].href]);
      await page.getByRole("link", { name: /Older/ }).click();
      await expect(page.locator("#article-title")).toHaveText(publishedInventory.writing[2].data.title);

      await navigationLink(page, "products").click();
      await expect(page.locator(".navigation__link[href='/products/']")).toHaveAttribute("aria-current", "page");
      await expect(page.locator("meta[name='robots'], .draft-label")).toHaveCount(0);
      await expect(page.locator("[data-graphic='products']")).toHaveAttribute("data-ready", "true");
      expect(await page.locator(".entries__item").evaluateAll((rows) => rows.map((row) => row.dataset.productIdentifier)))
        .toEqual(publishedInventory.products.map((entry) => entry.id));
      for (const product of [publishedInventory.products.find((entry) => entry.id === "alpha-product")]) {
        await page.getByRole("link", { name: product.data.title, exact: true }).click();
        await expect(page.locator("#product-title")).toHaveText(product.data.title);
        await expect(page.locator(".product__lede")).toHaveText(product.data.description);
        await expect(page.locator(".product__header .eyebrow")).toHaveText(product.data.status);
        await expect(page.locator(".product__prose")).toContainText(`Body for ${product.id}.`);
        await expect(page.locator(".navigation__link[href='/products/']")).toHaveAttribute("aria-current", "location");
        await expect(page.locator("meta[name='robots'], .draft-label")).toHaveCount(0);
        await expect(page.locator("link[rel='canonical']")).toHaveAttribute("href", `https://cristianvega.ai${product.href}`);
        await expect(page.locator("[data-graphic='products']")).toHaveAttribute("data-ready", "true");
        const outboundLink = page.locator(".product__link[target='_blank']");
        if (product.data.url) {
          await expect(outboundLink).toHaveAttribute("href", product.data.url);
          await expect(outboundLink).toHaveAttribute("rel", "noopener noreferrer");
        } else await expect(outboundLink).toHaveCount(0);
        expect(await contentSecurityPolicyViolations(page)).toEqual([]);
        await page.getByRole("link", { name: "All products →" }).click();
      }
      expect(await contentSecurityPolicyViolations(page)).toEqual([]);
      expect(recordedPageProblems).toEqual([]);
    });
  }

  test("Production routes and sitemap exclude explicit and default drafts", async ({ request, publication }) => {
    const publishedInventory = publishedContent(publication.inventory);
    const expectedPaths = ["/", "/about/", "/writing/", "/products/", ...Object.values(publishedInventory).flat().map((entry) => entry.href)].sort();
    const sitemapResponse = await request.get(`${publication.origin}/sitemap-0.xml`);
    expect(sitemapResponse.status()).toBe(200);
    const publishedPaths = [...(await sitemapResponse.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, sitemapAddress]) => new URL(sitemapAddress).pathname).sort();
    expect(publishedPaths).toEqual(expectedPaths);
    for (const entries of Object.values(publication.inventory)) {
      for (const draft of entries.filter((entry) => entry.data.draft)) {
        const response = await request.get(publication.origin + draft.href);
        expect(response.status(), draft.href).toBe(404);
        expectProductionHeaders(response.headers());
        expect(await response.text()).toContain("Page not found");
        expect(publishedPaths).not.toContain(draft.href);
      }
    }
  });

  test("Published pages receive noindex only on the Cloudflare preview hostname", async ({ request, publication }) => {
    const publishedInventory = publishedContent(publication.inventory);
    const publishedPaths = ["/", "/writing/", "/products/", ...Object.values(publishedInventory).flat().map((entry) => entry.href)];
    for (const publishedPath of publishedPaths) {
      for (const [requestHostname, expectedRobotsHeader] of [["cristianvega.ai", undefined], ["cristianvega-ai.preview.workers.dev", "noindex"]]) {
        const response = await request.get(publication.origin + publishedPath, { headers: { host: requestHostname } });
        expect(response.status(), publishedPath).toBe(200);
        expectProductionHeaders(response.headers());
        expect(response.headers()["x-robots-tag"], `${requestHostname}${publishedPath}`).toBe(expectedRobotsHeader);
        expect(await response.text()).not.toMatch(/name="robots" content="noindex/);
      }
    }
  });

  // Check copying with the share controls from a published article.
  for (const clipboardFails of [false, true]) {
    test(`A published article reports ${clipboardFails ? "clipboard failure" : "copy success"} in its own status`, async ({ page, publication }) => {
      const recordedPageProblems = pageProblems(page);
      await page.addInitScript((clipboardFails) => {
        window.__copiedLinks = [];
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
          async writeText(text) {
            window.__copiedLinks.push(text);
            if (clipboardFails) throw new Error("Clipboard blocked");
          },
        } });
      }, clipboardFails);
      const publishedArticle = publishedContent(publication.inventory).writing[0];
      await page.goto(publication.origin + publishedArticle.href);
      // Add a status before the article.
      // The copy result must update only the article status.
      await page.locator(".article").evaluate((articleElement) => articleElement.insertAdjacentHTML("beforebegin",
        '<span id="outside-status" class="share-status" role="status">Outside status</span>'));
      const copyButton = page.getByRole("button", { name: "copy link" });
      await expect(copyButton).toBeVisible();
      await copyButton.click();
      await expect(page.locator(".article .share-status")).toHaveText(clipboardFails
        ? "Copy the address from your browser to share this article."
        : "Link copied.");
      await expect(page.locator("#outside-status")).toHaveText("Outside status");
      expect(await page.evaluate(() => window.__copiedLinks)).toEqual([`https://cristianvega.ai${publishedArticle.href}`]);
      expect(recordedPageProblems).toEqual([]);
    });
  }

  test("A published article hides its copy button when the clipboard is unavailable", async ({ page, publication }) => {
    const recordedPageProblems = pageProblems(page);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    });
    const publishedArticle = publishedContent(publication.inventory).writing[0];
    await page.goto(publication.origin + publishedArticle.href);
    await expect(page.getByRole("link", { name: "Share on LinkedIn" })).toBeVisible();
    await expect(page.getByRole("button", { name: "copy link", includeHidden: true })).toBeHidden();
    await expect(page.locator(".article .share-status")).toBeEmpty();
    expect(recordedPageProblems).toEqual([]);
  });

  test("Published articles, products, and navigation remain available without JavaScript", async ({ browser, publication }) => {
    const browserContext = await browser.newContext({ javaScriptEnabled: false, viewport: viewports.mobile });
    try {
      const page = await browserContext.newPage();
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
      await browserContext.close();
    }
  });
});
