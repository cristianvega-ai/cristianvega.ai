import { expect, test } from "@playwright/test";
import { currentContent, DRAFT_ORIGIN as draftOrigin, expectReadablePage, navigationLink, VIEWPORTS as viewports } from "../shared/browser-fixtures.mjs";

// Real content must remain visible when JavaScript, canvas, fonts, or storage fail.
const globeSelector = "[data-lyra-globe]";
const aboutGraphicSelector = "[data-graphic='about']";
const writingGraphicSelector = "[data-graphic='writing']";
const articlePath = "/writing/full-article-layout-fixture/";
const articleTitle = "Lorem ipsum dolor sit amet";

test("Home preserves content, globe fallback, and navigation without JavaScript", async ({ browser, baseURL: baseAddress }) => {
  const browserContext = await browser.newContext({ javaScriptEnabled: false, viewport: viewports.mobile });
  try {
    const page = await browserContext.newPage();
    await page.goto(new URL("/", baseAddress).href);
    await expect(page.locator(`${globeSelector} .lyra-globe__fallback`)).toBeVisible();
    expect(await page.locator(`${globeSelector} path.is-hot`).count(), "The globe fallback must contain foreground paths without JavaScript").toBeGreaterThan(0);
    await expect(page.locator(`${globeSelector} text`).first()).toBeVisible();
    await expectReadablePage(page);
    await navigationLink(page, "about").click();
    await expect(page.locator(".about__profile")).toBeVisible();
  } finally {
    await browserContext.close();
  }
});

test("About keeps its profile readable without JavaScript", async ({ browser, baseURL: baseAddress }) => {
  const browserContext = await browser.newContext({ javaScriptEnabled: false, viewport: viewports.mobile });
  try {
    const page = await browserContext.newPage();
    await page.goto(new URL("/about/", baseAddress).href);
    await expect(page.locator(aboutGraphicSelector)).toBeHidden();
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator(".about__lede")).toBeVisible();
    await expect(page.locator(".about__profile")).toBeVisible();
  } finally {
    await browserContext.close();
  }
});

test("Writing preserves article content and navigation without JavaScript", async ({ browser }) => {
  const browserContext = await browser.newContext({ javaScriptEnabled: false, viewport: viewports.mobile });
  const page = await browserContext.newPage();
  await page.goto(draftOrigin + "/writing/");
  await page.getByRole("link", { name: articleTitle, exact: true }).click();
  await expect(page.locator("#article-title")).toHaveText(articleTitle);
  await expect(page.locator(".prose h2")).toHaveCount(3);
  await expect(page.locator(".prose pre")).toContainText("LoremIpsum");
  await expect(page.locator("[data-graphic]")).toHaveCount(0);
  await page.getByRole("link", { name: "← All articles" }).click();
  await expect(page.locator(".article-list__link")).toHaveCount(currentContent.writing.length);
  await expect(page.locator(writingGraphicSelector)).toHaveCSS("display", "none");
  await browserContext.close();
});

test("Writing preserves readable articles and lists when canvas, fonts, and storage fail", async ({ page }) => {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = () => null;
    Storage.prototype.getItem = () => { throw new Error("Storage blocked"); };
    Storage.prototype.setItem = () => { throw new Error("Storage blocked"); };
  });
  await page.route("**/*.woff2*", (route) => route.abort());
  await page.goto(draftOrigin + articlePath);
  await expect(page.locator("#article-title")).toBeVisible();
  await expect(page.locator("#article-title")).toHaveCSS("opacity", "1");
  await expect(page.locator(".prose h2")).toHaveCount(3);
  await expect(page.locator("[data-graphic]")).toHaveCount(0);
  await page.getByRole("link", { name: "← All articles" }).click();
  await expect(page.locator(".article-list__link")).toHaveCount(currentContent.writing.length);
  // The article list remains visible when the canvas is unavailable.
  await expect(page.locator(writingGraphicSelector)).toBeHidden();
});

test("A missing page remains readable without JavaScript", async ({ browser, baseURL: baseAddress }) => {
  const browserContext = await browser.newContext({ javaScriptEnabled: false, viewport: viewports.mobile });
  try {
    const page = await browserContext.newPage();
    const response = await page.goto(new URL("/missing-page-check/", baseAddress).href);
    expect(response.status()).toBe(404);
    await expect(page.locator("[data-graphic='404']")).toBeHidden();
    await expectReadablePage(page);
  } finally {
    await browserContext.close();
  }
});
