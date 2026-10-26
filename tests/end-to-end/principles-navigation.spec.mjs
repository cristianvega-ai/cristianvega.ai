import { expect, test } from "@playwright/test";
import { currentContent, DRAFT_ORIGIN as draftOrigin, pageProblems, settle, useReducedMotion } from "../shared/browser-fixtures.mjs";

// The development server lists the draft principles, so it serves the principles page.
// A principle lives at /principles/#<id>. Its star links to it and lights when the address points to it.
const principles = currentContent.principles;
const articleWithPrinciples = currentContent.writing.find((article) => article.data.principles.length > 0);
const litStarColor = "rgb(3, 105, 161)";
const unlitStarColor = "rgb(168, 176, 189)";

/** Read the fill of a principle's star. */
const starColor = (page, principleId) =>
  page.locator(`[id="${principleId}"] .principle__star`).evaluate((star) => getComputedStyle(star, "::before").backgroundColor);

test.beforeEach(async ({ page }) => {
  await useReducedMotion(page);
});

test("The principles page lists every principle under its group, in page order, with a star link and a draft mark", async ({ page }) => {
  const recordedPageProblems = pageProblems(page);
  expect(principles.length, "The repository must hold at least two principles").toBeGreaterThan(1);
  await page.goto(draftOrigin + "/principles/");
  await settle(page);
  await expect(page.locator("main h1")).toHaveText("Principles");
  expect(await page.locator("div.principle").evaluateAll((elements) => elements.map((element) => element.id)), "Principles: the page must follow page order")
    .toEqual(principles.map((principle) => principle.id));
  expect(await page.locator("h2.principle-group__label").evaluateAll((labels) => labels.map((label) => label.id)), "Principles: each group must appear once, in page order")
    .toEqual([...new Set(principles.map((principle) => `principle-group-${principle.data.group}`))]);
  for (const principle of principles) {
    const block = page.locator(`[id="${principle.id}"]`);
    await expect(block.locator(".principle__text")).toHaveText(principle.data.title);
    await expect(block.locator("a.principle__star")).toHaveAttribute("href", `#${principle.id}`);
    await expect(block.locator("a.principle__star")).toHaveAccessibleName(`Link to this principle: ${principle.data.title}`);
    await expect(block.locator(".principle__draft"), `${principle.id}: the development page must mark a draft`).toHaveCount(principle.data.draft ? 1 : 0);
  }
  await expect(page.locator("[data-reading-star] .reading-star__link")).toHaveAttribute("href", "/");
  expect(recordedPageProblems).toEqual([]);
});

test("A home principle row opens the principles page at its principle and lights its star", async ({ page }) => {
  await page.goto(draftOrigin + "/");
  await settle(page);
  const row = page.locator("section.home-section[aria-labelledby='principles-label'] a.entry-row").first();
  const principleId = new URL(await row.getAttribute("href"), draftOrigin).hash.slice(1);
  expect(principles.map((principle) => principle.id), "Home: the row must link to a principle").toContain(principleId);
  await row.click();
  await page.waitForURL(`**/principles/#${principleId}`);
  await expect.poll(() => starColor(page, principleId), { message: "Principles: the star of the opened principle must light" }).toBe(litStarColor);
  const statementBox = await page.locator(`[id="${principleId}"] .principle__text`).boundingBox();
  expect(statementBox.y, "Principles: the opened principle must start on screen").toBeGreaterThanOrEqual(0);
  expect(statementBox.y + statementBox.height, "Principles: the opened principle must end on screen").toBeLessThanOrEqual(page.viewportSize().height);
});

test("A star click points the address to its principle and lights only that star", async ({ page }) => {
  const [firstPrinciple, secondPrinciple] = principles;
  await page.goto(`${draftOrigin}/principles/#${firstPrinciple.id}`);
  await settle(page);
  await expect.poll(() => starColor(page, firstPrinciple.id)).toBe(litStarColor);
  await page.locator(`[id="${secondPrinciple.id}"] a.principle__star`).click();
  await expect(page).toHaveURL(`${draftOrigin}/principles/#${secondPrinciple.id}`);
  await expect.poll(() => starColor(page, secondPrinciple.id), { message: "Star: the clicked star must light" }).toBe(litStarColor);
  expect(await starColor(page, firstPrinciple.id), "Star: the earlier star must go out").toBe(unlitStarColor);
});

test("An article lists the principles it names, and a row opens its principle", async ({ page }) => {
  expect(articleWithPrinciples, "The repository must hold an article that names a principle").toBeTruthy();
  const expectedAddresses = principles.filter((principle) => articleWithPrinciples.data.principles.includes(principle.id)).map((principle) => principle.href);
  await page.goto(draftOrigin + articleWithPrinciples.href);
  await settle(page);
  const rows = page.locator("section[aria-labelledby='article-principles'] a.entry-row");
  await expect(page.locator("#article-principles")).toHaveText("Principles in this piece");
  expect(await rows.evaluateAll((links) => links.map((link) => link.getAttribute("href"))), "Article: the rows must list the named principles in page order").toEqual(expectedAddresses);
  await rows.first().click();
  await page.waitForURL(`**${expectedAddresses[0]}`);
  await expect.poll(() => starColor(page, expectedAddresses[0].split("#")[1])).toBe(litStarColor);
});
