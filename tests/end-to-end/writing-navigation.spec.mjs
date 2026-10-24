import { expect, test } from "@playwright/test";
import { currentContent, currentPublished, DRAFT_ORIGIN as draftOrigin, expectReadablePage, pageProblems, readingStar, settle, tabTo, useReducedMotion, VIEWPORTS as viewports } from "../shared/browser-fixtures.mjs";

const articlePath = "/writing/full-article-layout-fixture/";
const articleTitle = "Lorem ipsum dolor sit amet";

// Keep one article with long code and a diagram in both widths.
for (const viewport of [viewports.desktop, viewports.mobile]) {
  test(`Writing opens an article from the home page and returns to the list at ${viewport.width}px`, async ({ page }) => {
    const recordedPageProblems = pageProblems(page);
    await page.setViewportSize(viewport);
    await useReducedMotion(page);
    await page.goto(draftOrigin + "/");
    await page.getByRole("link", { name: "All writing", exact: true }).click();
    await expect(page.locator("main h1")).toHaveText("Writing");
    // A draft row also says Draft, so the link is found by its address.
    await page.locator(`a.entry-row[href='${articlePath}']`).click();
    await expect(page).toHaveURL(draftOrigin + articlePath);
    await settle(page);
    await expectReadablePage(page);
    await expect(page.locator("h1#page-title")).toHaveText(articleTitle);
    await expect(page.locator(".prose pre")).toBeVisible();
    await expect(page.locator(".figure__panel")).toBeVisible();
    await expect(page.locator("link[rel='canonical']")).toHaveAttribute("href", "https://cristianvega.ai" + articlePath);
    await readingStar(page).link.click();
    await expect(page.locator("main h1")).toHaveText("Writing");
    await expect(page.locator("a.entry-row")).toHaveCount(currentContent.writing.length);
    expect(recordedPageProblems).toEqual([]);
  });
}

test("Writing groups articles under year headings with the day and month on each row", async ({ page }) => {
  await useReducedMotion(page);
  await page.goto(draftOrigin + "/writing/");
  await settle(page);
  const expectedYears = [...new Set(currentContent.writing.map((articleEntry) => articleEntry.data.date.getUTCFullYear()))];
  expect(await page.locator("h2.detail__section-label").allTextContents(), "Writing: the years must run from newest to oldest").toEqual(expectedYears.map(String));
  for (const year of expectedYears) {
    const yearSection = page.locator(`section.detail__section:has(h2#writing-${year})`);
    const yearHrefs = currentContent.writing.filter((articleEntry) => articleEntry.data.date.getUTCFullYear() === year).map((articleEntry) => articleEntry.href);
    expect(await yearSection.locator("a.entry-row").evaluateAll((links) => links.map((link) => link.getAttribute("href"))), `Writing ${year}: the rows must list that year, newest first`).toEqual(yearHrefs);
    // The heading names the year, so a row shows only the day and the month.
    for (const dateText of await yearSection.locator(".entry-row__meta").allTextContents()) {
      expect(dateText, `Writing ${year}: a row date must show a day and a month without the year`).toMatch(/^\d{1,2} [A-Z][a-z]+\.?$/);
    }
  }
});

test("Writing drafts appear locally and remain unavailable in production", async ({ page, request }) => {
  await page.goto(draftOrigin + "/writing/");
  await settle(page);
  await expect(page.locator("a.entry-row")).toHaveCount(currentContent.writing.length);
  await expect(page.locator(".entry-row__draft")).toHaveCount(currentContent.writing.filter((articleEntry) => articleEntry.data.draft).length);
  await expect(page.locator("meta[name='robots']"), "Writing: a list with drafts must stay out of search results").toHaveAttribute("content", "noindex, follow");
  const articleLinks = await page.locator("a.entry-row").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")));
  expect(articleLinks).toEqual(currentContent.writing.map((articleEntry) => articleEntry.href));
  for (const articleEntry of currentContent.writing) {
    const response = await request.get(articleEntry.href);
    expect(response.status(), articleEntry.href).toBe(articleEntry.data.draft ? 404 : 200);
  }
  const writingResponse = await request.get("/writing/");
  expect(writingResponse.status()).toBe(currentPublished.writing.length > 0 ? 200 : 404);
});

test("Writing opens the first article with Enter and shows the draft preview state", async ({ page }) => {
  await useReducedMotion(page);
  await page.goto(draftOrigin + "/writing/");
  await settle(page);
  expect(await tabTo(page, "a.entry-row >> nth=0")).toBe(true);
  const firstArticle = currentContent.writing[0];
  await expect(page.locator("a.entry-row").first()).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(draftOrigin + firstArticle.href);
  if (firstArticle.data.draft) {
    await expect(page.locator(".detail__draft")).toHaveText("Draft preview · not published");
    await expect(page.locator("meta[name='robots']")).toHaveAttribute("content", "noindex, follow");
    await expect(page.locator(".article__share")).toHaveCount(0);
  } else {
    await expect(page.locator(".detail__draft, meta[name='robots']")).toHaveCount(0);
    await expect(page.locator(".article__share")).toHaveCount(1);
  }
  await readingStar(page).link.click();
  await expect(page.locator("main h1")).toHaveText("Writing");
});

test("Article neighbours list the newer article first and open correctly", async ({ page }) => {
  await useReducedMotion(page);
  await page.goto(draftOrigin + articlePath);
  await settle(page);
  await expect(page.locator(".prose h2")).toHaveCount(3);
  await expect(page.locator(".prose pre")).toHaveAttribute("tabindex", "0");
  await expect(page.locator(".prose pre")).toHaveAttribute("aria-label", "Code example");
  const articleIndex = currentContent.writing.findIndex((articleEntry) => articleEntry.href === articlePath);
  const newerArticle = currentContent.writing[articleIndex - 1];
  const olderArticle = currentContent.writing[articleIndex + 1];
  expect(newerArticle && olderArticle, "The navigation fixture must have a newer and an older article").toBeTruthy();
  const moreWriting = page.locator("nav[aria-labelledby='more-writing']");
  await expect(moreWriting.getByRole("heading", { name: "More writing" })).toBeVisible();
  expect(await moreWriting.locator("a.entry-row").evaluateAll((links) => links.map((link) => link.getAttribute("href"))), "More writing: the newer article must come first")
    .toEqual([newerArticle.href, olderArticle.href]);
  await moreWriting.locator("a.entry-row").first().click();
  await expect(page.locator("h1#page-title")).toHaveText(newerArticle.data.title);
  await expect(page.locator("nav[aria-labelledby='more-writing'] a.entry-row").filter({ hasText: articleTitle })).toHaveCount(1);
  await page.locator("nav[aria-labelledby='more-writing'] a.entry-row").filter({ hasText: articleTitle }).click();
  await expect(page.locator("h1#page-title")).toHaveText(articleTitle);
});

test("The newest article lists only its older neighbour", async ({ page }) => {
  await page.goto(draftOrigin + currentContent.writing[0].href);
  const neighbourLinks = page.locator("nav[aria-labelledby='more-writing'] a.entry-row");
  await expect(neighbourLinks).toHaveCount(1);
  await expect(neighbourLinks).toHaveAttribute("href", currentContent.writing[1].href);
});
