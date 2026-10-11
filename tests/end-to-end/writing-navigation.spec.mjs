import { expect, test } from "@playwright/test";
import { currentContent, currentPublished, DRAFT_ORIGIN as draftOrigin, expectReadablePage, navigationLink, pageProblems, settle, useReducedMotion, VIEWPORTS as viewports } from "../shared/browser-fixtures.mjs";

const articlePath = "/writing/full-article-layout-fixture/";
const articleTitle = "Lorem ipsum dolor sit amet";
const graphicSelector = "[data-graphic='writing']";

// Keep one article with long code and a diagram in both navigation layouts.
for (const viewport of [viewports.desktop, viewports.mobile]) {
  test(`Writing opens an article and returns to the list at ${viewport.width}px`, async ({ page }) => {
    const recordedPageProblems = pageProblems(page);
    await page.setViewportSize(viewport);
    await useReducedMotion(page);
    await page.goto(draftOrigin + "/");
    await navigationLink(page, "writing").click();
    await expect(page.locator("#writing-title")).toBeVisible();
    await page.getByRole("link", { name: articleTitle, exact: true }).click();
    await expect(page).toHaveURL(draftOrigin + articlePath);
    await settle(page);
    await expectReadablePage(page);
    await expect(page.locator(".prose pre")).toBeVisible();
    await expect(page.locator(".figure__panel")).toBeVisible();
    await expect(page.locator("link[rel='canonical']")).toHaveAttribute("href", "https://cristianvega.ai" + articlePath);
    await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
    expect(await page.locator("#main-content").evaluate((mainContent) =>
      mainContent.getBoundingClientRect().bottom <= document.querySelector(".site-footer").getBoundingClientRect().top,
    ), "The footer must stay below the article content").toBe(true);
    await page.getByRole("link", { name: "← All articles" }).click();
    await expect(page.locator(".article-list__link")).toHaveCount(currentContent.writing.length);
    expect(recordedPageProblems).toEqual([]);
  });
}

test("Writing drafts appear locally and remain unavailable in production", async ({ page, request }) => {
  await page.goto(draftOrigin + "/writing/");
  await expect(page.locator(graphicSelector)).toHaveAttribute("data-ready", "true");
  await settle(page);
  await expect(page.locator(".article-list__item")).toHaveCount(currentContent.writing.length);
  await expect(page.locator(".draft-label")).toHaveCount(currentContent.writing.filter((articleEntry) => articleEntry.data.draft).length);
  const articleLinks = await page.locator(".article-list__link").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")));
  expect(articleLinks).toEqual(currentContent.writing.map((articleEntry) => articleEntry.href));
  for (const articleEntry of currentContent.writing) {
    const response = await request.get(articleEntry.href);
    expect(response.status(), articleEntry.href).toBe(articleEntry.data.draft ? 404 : 200);
  }
  const writingResponse = await request.get("/writing/");
  expect(writingResponse.status()).toBe(currentPublished.writing.length > 0 ? 200 : 404);
});

test("Article sections expose controls and adjacent article links open correctly", async ({ page }) => {
  await useReducedMotion(page);
  await page.goto(draftOrigin + articlePath);
  await expect(page.locator(".prose h2")).toHaveCount(3);
  await expect(page.locator(".prose .pipeline")).toHaveAttribute("role", "img");
  await expect(page.locator(".prose pre")).toHaveAttribute("tabindex", "0");
  await expect(page.locator(".prose pre")).toHaveAttribute("aria-label", "Code example");
  const articleIndex = currentContent.writing.findIndex((articleEntry) => articleEntry.href === articlePath);
  const newerArticle = currentContent.writing[articleIndex - 1];
  const currentArticle = currentContent.writing[articleIndex];
  const newerLink = page.locator(".read-next__newer");
  await expect(newerLink).toHaveAttribute("href", newerArticle.href);
  await expect(newerLink.locator("span")).toHaveText(`Newer${newerArticle.data.draft ? " · Draft" : ""} →`);
  await newerLink.click();
  await expect(page.locator("#article-title")).toHaveText(newerArticle.data.title);
  const olderLink = page.locator(`.read-next a[href='${articlePath}']`);
  await expect(olderLink.locator("span")).toHaveText(`← Older${currentArticle.data.draft ? " · Draft" : ""}`);
  await olderLink.click();
  await expect(page.locator("#article-title")).toHaveText(articleTitle);
});
