import { expect, test } from "@playwright/test";
import { homeSections } from "../shared/node-helpers.mjs";
import { currentContent, DRAFT_ORIGIN as draftOrigin, expectReadablePage, readingStar, settle, VIEWPORTS as viewports } from "../shared/browser-fixtures.mjs";

// Real content must remain visible when JavaScript, fonts, or storage fail.
const articlePath = "/writing/full-article-layout-fixture/";
const articleTitle = "Lorem ipsum dolor sit amet";
// The home page lists only the newest articles, so the home flows open the newest one.
const newestArticle = currentContent.writing[0];

/** Open a page in a browser context without JavaScript. */
async function withoutJavaScript(browser, useContext) {
  const browserContext = await browser.newContext({ javaScriptEnabled: false, viewport: viewports.mobile });
  try {
    await useContext(await browserContext.newPage());
  } finally {
    await browserContext.close();
  }
}

test("Home keeps its upright mark, text, profiles, and sections without JavaScript", async ({ browser }) => {
  await withoutJavaScript(browser, async (page) => {
    await page.goto(draftOrigin + "/");
    await expectReadablePage(page);
    await expect(page.locator("h1.identity__name")).toHaveText("Cristian Vega");
    await expect(page.locator("p.bio")).toBeVisible();
    await expect(page.locator("ul.profile-links a")).toHaveCount(3);
    // The script that turns the mark does not run, so the figure stays upright and complete.
    const mark = page.locator("header.identity svg.mark");
    await expect(mark).toBeVisible();
    await expect(mark.locator(".mark__star")).toHaveCount(5);
    await expect(mark.locator(".mark__line")).toHaveCount(6);
    expect(await mark.locator(".mark__sky").evaluate((element) => getComputedStyle(element).transform), "Home mark: the figure must stand upright without the script")
      .toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
    await expect(page.locator("section.home-section")).toHaveCount(homeSections(currentContent, { includeDrafts: true }).length);
    // The row link works as a plain link, and the heading of the next page is readable.
    await page.locator("section.home-section[aria-labelledby='writing-label'] a.entry-row").first().click();
    await expect(page.locator("main h1")).toHaveText(newestArticle.data.title);
  });
});

test("An article keeps its reading star, whole figure, and readable text without JavaScript", async ({ browser }) => {
  await withoutJavaScript(browser, async (page) => {
    await page.goto(draftOrigin + articlePath);
    await expect(page.locator("#page-title")).toHaveText(articleTitle);
    await expect(page.locator(".prose h2")).toHaveCount(3);
    await expect(page.locator(".prose pre")).toContainText("LoremIpsum");
    const { link, label, mark, lines } = readingStar(page);
    await expect(link, "Reading star: it must be a visible link without JavaScript").toBeVisible();
    await expect(mark).toBeVisible();
    await expect(label).toHaveText("Writing");
    // No script draws the lines by progress, so none may stay hidden by a dash offset.
    await expect(lines).toHaveCount(6);
    expect(await lines.evaluateAll((figureLines) => figureLines.map((line) => parseFloat(getComputedStyle(line).strokeDashoffset))), "Reading star: every line must show without JavaScript")
      .toEqual(Array(6).fill(0));
    await expect(page.locator("button[data-copy-link]:visible"), "Article: the copy button must stay hidden without JavaScript").toHaveCount(0);
    await link.click();
    await expect(page.locator("main h1")).toHaveText("Writing");
    await expect(page.locator("a.entry-row")).toHaveCount(currentContent.writing.length);
  });
});

test("A missing page remains readable without JavaScript and keeps its way home", async ({ browser, baseURL: baseAddress }) => {
  await withoutJavaScript(browser, async (page) => {
    const response = await page.goto(new URL("/missing-page-check/", baseAddress).href);
    expect(response.status()).toBe(404);
    await expectReadablePage(page);
    await expect(page.locator("main h1")).toHaveText("This page doesn't exist.");
    await expect(readingStar(page).link).toBeVisible();
    await page.locator(".detail__lede").getByRole("link", { name: "home page" }).click();
    await expect(page.locator("h1.identity__name")).toBeVisible();
  });
});

test("Pages stay readable and navigable when fonts and storage fail", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  // A browser that blocks site data throws when a script reads sessionStorage.
  await page.addInitScript(() => {
    Object.defineProperty(window, "sessionStorage", { configurable: true, get() { throw new DOMException("Storage blocked", "SecurityError"); } });
  });
  await page.route("**/*.woff2*", (route) => route.abort());
  await page.goto(draftOrigin + "/");
  await expect(page.locator("h1.identity__name")).toBeVisible();
  await page.locator(`a.entry-row[href='${newestArticle.href}']`).click();
  await expect(page.locator("#page-title")).toBeVisible();
  await expect(page.locator("#page-title")).toHaveCSS("opacity", "1");
  await expect(page.locator(".prose")).toBeVisible();
  await readingStar(page).link.click();
  await expect(page.locator("h1.identity__name")).toBeVisible();
  expect(pageErrors, "Pages: blocked storage and fonts must raise no script error").toEqual([]);
});

test("The star still draws and leads up when the Navigation API is missing", async ({ page }) => {
  // The star falls back to a plain link to the parent page when the browser cannot report the previous page.
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => { Object.defineProperty(window, "navigation", { configurable: true, value: undefined }); });
  await page.goto(draftOrigin + "/");
  await settle(page);
  await page.locator(`a.entry-row[href='${newestArticle.href}']`).click();
  await expect(readingStar(page).label).toHaveText("Writing");
  // The script sets a dash offset on every line, so a value shows that the setup ran to its end.
  await expect.poll(() => readingStar(page).lines.first().evaluate((line) => line.style.strokeDashoffset), { message: "Reading star: the setup must finish without the Navigation API" }).not.toBe("");
  await readingStar(page).link.click();
  await expect(page).toHaveURL(draftOrigin + "/writing/");
  expect(pageErrors, "Reading star: a missing Navigation API must raise no script error").toEqual([]);
});
