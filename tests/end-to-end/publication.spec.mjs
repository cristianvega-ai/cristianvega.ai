import { expect } from "@playwright/test";
import { homeSections, permissionsPolicy, publishedContent } from "../shared/node-helpers.mjs";
import { contentSecurityPolicyViolations, pageProblems, publicationTest as test, readingStar, recordContentSecurityPolicyViolations, settle, tabTo, useReducedMotion, VIEWPORTS as viewports } from "../shared/browser-fixtures.mjs";

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
      const publishedInventory = publishedContent(publication.inventory);

      // The homepage lists the published entries of each section, products first, and no draft.
      const expectedSections = homeSections(publication.inventory);
      expect(expectedSections.map((homeSection) => homeSection.section), "Both sections must be published in this fixture").toEqual(["products", "writing"]);
      await expect(page.locator("section.home-section")).toHaveCount(expectedSections.length);
      for (const expectedSection of expectedSections) {
        const sectionRows = page.locator(`section.home-section[aria-labelledby='${expectedSection.headingId}'] a.entry-row`);
        expect(await sectionRows.evaluateAll((links) => links.map((link) => link.getAttribute("href"))), `${expectedSection.label}: the homepage rows must list the published entries`)
          .toEqual(expectedSection.rows.map((entry) => entry.href));
      }
      await expect(page.locator(".entry-row__draft, meta[name='robots']")).toHaveCount(0);
      await expect(page.locator("nav, footer")).toHaveCount(0);

      await page.getByRole("link", { name: "All writing", exact: true }).click();
      await expect(page).toHaveURL(publication.origin + "/writing/");
      await expect(page.locator("main h1")).toHaveText("Writing");
      await expect(page.locator("meta[name='robots'], .entry-row__draft")).toHaveCount(0);
      expect(await page.locator("a.entry-row").evaluateAll((links) => links.map((link) => link.getAttribute("href"))))
        .toEqual(publishedInventory.writing.map((entry) => entry.href));
      expect(await tabTo(page, "a.entry-row >> nth=1")).toBe(true);
      await page.keyboard.press("Enter");
      const publishedArticle = publishedInventory.writing[1];
      await expect(page).toHaveURL(publication.origin + publishedArticle.href);
      await expect(page.locator("h1#page-title")).toHaveText(publishedArticle.data.title);
      await expect(page.locator(".detail__lede")).toHaveText(publishedArticle.data.description);
      await expect(page.locator(".detail__draft, .entry-row__draft, meta[name='robots']")).toHaveCount(0);
      await expect(page.locator("link[rel='canonical']")).toHaveAttribute("href", `https://cristianvega.ai${publishedArticle.href}`);
      await expect(page.locator("meta[property='article:published_time']")).toHaveAttribute("content", publishedArticle.data.date.toISOString());
      await expect(page.locator(".prose")).toContainText(`Body for ${publishedArticle.id}.`);
      await expect(page.locator(".prose pre")).toHaveAttribute("aria-label", "Code example");
      await expect(page.locator(".figure__panel")).toHaveAttribute("aria-label", "Fixture signal path");
      await expect(page.locator(".figure__panel")).toHaveAttribute("role", "img");
      await expect(page.locator(".article__share a")).toHaveCount(2);
      for (const link of await page.locator(".article__share a").all()) {
        await expect(link).toHaveAttribute("rel", "noopener noreferrer");
      }
      await page.getByRole("button", { name: "Copy link" }).click();
      await expect(page.locator(".share-status")).toHaveText("Link copied.");
      expect(await page.evaluate(() => window.__publicationCopies)).toEqual([`https://cristianvega.ai${publishedArticle.href}`]);
      expect(await page.locator("nav[aria-labelledby='more-writing'] a.entry-row").evaluateAll((links) => links.map((link) => link.getAttribute("href"))), "More writing must list the newer article, then the older one")
        .toEqual([publishedInventory.writing[0].href, publishedInventory.writing[2].href]);
      await page.locator(`nav[aria-labelledby='more-writing'] a.entry-row[href='${publishedInventory.writing[2].href}']`).click();
      await expect(page.locator("h1#page-title")).toHaveText(publishedInventory.writing[2].data.title);
      await expect(readingStar(page).label).toHaveText("Writing");

      await page.goto(publication.origin + "/");
      await page.getByRole("link", { name: "All products", exact: true }).click();
      await expect(page).toHaveURL(publication.origin + "/products/");
      await expect(page.locator("meta[name='robots'], .entry-row__draft")).toHaveCount(0);
      expect(await page.locator("a.entry-row").evaluateAll((links) => links.map((link) => link.getAttribute("href"))))
        .toEqual(publishedInventory.products.map((entry) => entry.href));
      const product = publishedInventory.products.find((entry) => entry.id === "alpha-product");
      await page.locator(`a.entry-row[href='${product.href}']`).click();
      await expect(page.locator("h1#page-title")).toHaveText(product.data.title);
      await expect(page.locator(".detail__lede")).toHaveText(product.data.description);
      await expect(page.locator(".detail__meta")).toHaveText(product.data.status);
      await expect(page.locator(".prose")).toContainText(`Body for ${product.id}.`);
      await expect(page.locator("meta[name='robots'], .detail__draft")).toHaveCount(0);
      await expect(page.locator("link[rel='canonical']")).toHaveAttribute("href", `https://cristianvega.ai${product.href}`);
      const outboundLink = page.locator("a.product__link[target='_blank']");
      await expect(outboundLink).toHaveText(`Visit ${product.data.title} ↗`);
      await expect(outboundLink).toHaveAttribute("href", product.data.url);
      await expect(outboundLink).toHaveAttribute("rel", "noopener noreferrer");
      expect(await contentSecurityPolicyViolations(page)).toEqual([]);
      await readingStar(page).link.click();
      await expect(page.locator("main h1")).toHaveText("Products");
      expect(await contentSecurityPolicyViolations(page)).toEqual([]);
      expect(recordedPageProblems).toEqual([]);
    });
  }

  test("Production routes and sitemap exclude explicit and default drafts", async ({ request, publication }) => {
    const publishedInventory = publishedContent(publication.inventory);
    const expectedPaths = ["/", "/writing/", "/products/", ...Object.values(publishedInventory).flat().map((entry) => entry.href)].sort();
    const sitemapResponse = await request.get(`${publication.origin}/sitemap-0.xml`);
    expect(sitemapResponse.status()).toBe(200);
    const publishedPaths = [...(await sitemapResponse.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, sitemapAddress]) => new URL(sitemapAddress).pathname).sort();
    expect(publishedPaths).toEqual(expectedPaths);
    for (const entries of Object.values(publication.inventory)) {
      for (const draft of entries.filter((entry) => entry.data.draft)) {
        const response = await request.get(publication.origin + draft.href);
        expect(response.status(), draft.href).toBe(404);
        expectProductionHeaders(response.headers());
        expect(await response.text()).toContain("This page doesn&#39;t exist.");
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
      const copyButton = page.getByRole("button", { name: "Copy link" });
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
    await expect(page.getByRole("button", { name: "Copy link", includeHidden: true })).toBeHidden();
    await expect(page.locator(".article .share-status")).toBeEmpty();
    expect(recordedPageProblems).toEqual([]);
  });

  test("Published articles, products, and the star remain available without JavaScript", async ({ browser, publication }) => {
    // Reduced motion turns page transitions off. A running transition makes the page ignore clicks in headless Chromium.
    const browserContext = await browser.newContext({ javaScriptEnabled: false, reducedMotion: "reduce", viewport: viewports.mobile });
    try {
      const page = await browserContext.newPage();
      await page.goto(publication.origin);
      await page.getByRole("link", { name: "All writing", exact: true }).click();
      // A writing row also reads its date, so the name match is not exact.
      await page.getByRole("link", { name: "Alpha tied writing" }).click();
      await expect(page.locator(".prose")).toContainText("Body for alpha-tied.");
      await expect(page.getByRole("button", { name: "Copy link" })).toBeHidden();
      await expect(page.getByRole("link", { name: "Share on LinkedIn" })).toBeVisible();
      await readingStar(page).link.click();
      await expect(page.locator("main h1")).toHaveText("Writing");
      await page.goto(publication.origin + "/products/");
      // A product row also reads its description, so the name match is not exact.
      await page.getByRole("link", { name: "Alpha product" }).click();
      await expect(page.locator(".prose")).toContainText("Body for alpha-product.");
      const product = publishedContent(publication.inventory).products.find((entry) => entry.id === "alpha-product");
      await expect(page.locator("a.product__link[target='_blank']")).toHaveAttribute("href", product.data.url);
    } finally {
      await browserContext.close();
    }
  });
});
