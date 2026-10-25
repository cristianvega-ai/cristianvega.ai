import { expect, test } from "@playwright/test";
import { DRAFT_ORIGIN as draftOrigin, settle, useReducedMotion } from "../shared/browser-fixtures.mjs";

// A duplicate view-transition-name cancels the whole page transition.
// Exactly one element may hold the name "title": the clicked row title, never the page heading as well.
const articlePath = "/writing/full-article-layout-fixture/";

/** Stop links from navigating, so the test can read the names that a click sets. */
const blockNavigation = (page) =>
  page.evaluate(() => window.addEventListener("click", (event) => event.preventDefault(), { capture: true }));

/** Describe the elements whose computed view-transition-name is "title". */
const readTitleHolders = (page) =>
  page.evaluate(() => [...document.querySelectorAll("*")]
    .filter((element) => getComputedStyle(element).viewTransitionName === "title")
    .map((element) => ({ className: element.className, text: element.textContent.trim() })));

test.beforeEach(async ({ page }) => {
  await useReducedMotion(page);
});

for (const [sectionName, rowIndex] of [["Products", 0], ["Writing", 0], ["Writing", 2]]) {
  test(`A click on ${sectionName} row ${rowIndex + 1} names only that row title on the home page`, async ({ page }) => {
    await page.goto(draftOrigin + "/");
    await settle(page);
    expect(await readTitleHolders(page), "Home: no element may hold the name before a click").toEqual([]);
    await blockNavigation(page);
    const row = page.locator(`section.home-section[aria-labelledby='${sectionName.toLowerCase()}-label'] a.entry-row`).nth(rowIndex);
    await row.click();
    const titleHolders = await readTitleHolders(page);
    expect(titleHolders, "Home: exactly one element must hold the name title").toHaveLength(1);
    expect(titleHolders[0].className, "Home: the holder must be a row title").toBe("entry-row__title");
    expect(titleHolders[0].text, "Home: the holder must be the clicked row title").toBe(await row.locator(".entry-row__title").innerText());
  });
}

test("A click on a More writing row moves the name from the page heading to that row title", async ({ page }) => {
  await page.goto(draftOrigin + articlePath);
  await settle(page);
  const heading = page.locator("h1[data-morph-title]");
  const beforeClick = await readTitleHolders(page);
  expect(beforeClick, "Article: before a click, the page heading must hold the name").toHaveLength(1);
  expect(beforeClick[0].className).toBe("detail__title");
  await blockNavigation(page);
  const neighbourRow = page.locator("nav[aria-labelledby='more-writing'] a.entry-row").first();
  await neighbourRow.click();
  const titleHolders = await readTitleHolders(page);
  expect(titleHolders, "Article: exactly one element must hold the name title").toHaveLength(1);
  expect(titleHolders[0].className, "Article: the holder must be a row title").toBe("entry-row__title");
  expect(titleHolders[0].text, "Article: the holder must be the clicked row title").toBe(await neighbourRow.locator(".entry-row__title").innerText());
  expect(await heading.evaluate((element) => getComputedStyle(element).viewTransitionName), "Article: the page heading must let the name go").toBe("none");
});

test("A second row click moves the name and keeps one holder", async ({ page }) => {
  await page.goto(draftOrigin + "/");
  await settle(page);
  await blockNavigation(page);
  const rows = page.locator("section.home-section[aria-labelledby='writing-label'] a.entry-row");
  await rows.nth(0).click();
  await rows.nth(1).click();
  const titleHolders = await readTitleHolders(page);
  expect(titleHolders, "Home: after two clicks, exactly one element must hold the name").toHaveLength(1);
  expect(titleHolders[0].text).toBe(await rows.nth(1).locator(".entry-row__title").innerText());
});

test("A modified click leaves the names unchanged", async ({ page }) => {
  await page.goto(draftOrigin + "/");
  await settle(page);
  await blockNavigation(page);
  await page.locator("a.entry-row").first().click({ modifiers: ["Shift"] });
  expect(await readTitleHolders(page), "Home: a click with a modifier key opens a new window and must name nothing").toEqual([]);
});
