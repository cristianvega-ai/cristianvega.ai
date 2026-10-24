import { expect, test } from "@playwright/test";
import { currentContent, DRAFT_ORIGIN as draftOrigin, pageProblems, readingStar, settle, useReducedMotion } from "../shared/browser-fixtures.mjs";

const articlePath = "/writing/full-article-layout-fixture/";
const productPath = currentContent.products[0].href;

test.beforeEach(async ({ page }) => {
  await useReducedMotion(page);
});

const historyIndex = (page) => page.evaluate(() => navigation.currentEntry.index);

/** Record each navigation that the page starts and cancel it when the browser allows. Keep the page in place. */
const recordNavigations = (page) =>
  page.evaluate(() => {
    window.__navigations = [];
    navigation.addEventListener("navigate", (event) => {
      window.__navigations.push({ destination: new URL(event.destination.url).pathname, type: event.navigationType });
      if (event.cancelable) event.preventDefault();
    });
  });
const readNavigations = (page) => page.evaluate(() => window.__navigations);

test("The star on a page opened by address leads one level up and pushes a new history entry", async ({ page }) => {
  const recordedPageProblems = pageProblems(page);
  await page.goto(draftOrigin + articlePath);
  await settle(page);
  const { link, label } = readingStar(page);
  await expect(label).toHaveText("Writing");
  await expect(link).toHaveAttribute("href", "/writing/");
  const indexBefore = await historyIndex(page);
  await link.click();
  await expect(page).toHaveURL(draftOrigin + "/writing/");
  await expect(page.locator("main h1")).toHaveText("Writing");
  expect(await historyIndex(page), "Star: with no previous page the star must add a history entry").toBe(indexBefore + 1);
  expect(recordedPageProblems).toEqual([]);
});

test("The product star leads to Products and the missing-page star leads home", async ({ page, request }) => {
  await page.goto(draftOrigin + productPath);
  await settle(page);
  await expect(readingStar(page).label).toHaveText("Products");
  await expect(readingStar(page).link).toHaveAttribute("href", "/products/");
  await readingStar(page).link.click();
  await expect(page).toHaveURL(draftOrigin + "/products/");

  const response = await page.goto("/missing-star-navigation-check/");
  expect(response.status()).toBe(404);
  await settle(page);
  await expect(readingStar(page).label).toHaveText("Home");
  await expect(readingStar(page).link).toHaveAttribute("href", "/");
  await readingStar(page).link.click();
  await expect(page.locator("h1.identity__name")).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/");
});

test("The star returns through history to the list and keeps its scroll position", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 420 });
  await page.goto(draftOrigin + "/writing/");
  await settle(page);
  await page.evaluate(() => scrollTo({ top: 200, behavior: "instant" }));
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(200);
  await page.locator("a.entry-row").nth(2).click();
  await expect(page.locator("main h1")).not.toHaveText("Writing");
  await settle(page);
  const indexBefore = await historyIndex(page);
  await expect(readingStar(page).label).toHaveText("Writing");
  await readingStar(page).link.click();
  await expect(page).toHaveURL(draftOrigin + "/writing/");
  expect(await historyIndex(page), "Star: after a list visit the star must go back in history").toBe(indexBefore - 1);
  await expect.poll(() => page.evaluate(() => scrollY), { message: "Star: the list must return at its earlier scroll position" }).toBe(200);
});

test("The star on a page opened from the homepage reads Home and returns there through history", async ({ page, context }) => {
  await page.goto(draftOrigin + "/");
  await settle(page);
  await page.locator("section.home-section[aria-labelledby='writing-label'] a.entry-row").first().click();
  await expect(page.locator("main h1")).not.toHaveText("Cristian Vega");
  await settle(page);
  const { link, label } = readingStar(page);
  await expect(label, "Star: after the homepage the label must name the homepage").toHaveText("Home");
  await expect(link, "Star: after the homepage the address must lead to the homepage").toHaveAttribute("href", "/");
  const indexBefore = await historyIndex(page);

  // A click with a modifier key opens the address that the label names, in a new tab, and leaves this page.
  const newTabOpened = context.waitForEvent("page");
  await link.click({ modifiers: ["ControlOrMeta"] });
  const newTab = await newTabOpened;
  await newTab.waitForLoadState();
  expect(new URL(newTab.url()).pathname, "Star: a new-tab click must open what the label says").toBe("/");
  await newTab.close();
  expect(await historyIndex(page), "Star: a new-tab click must leave this page in place").toBe(indexBefore);

  await link.click();
  await expect(page).toHaveURL(draftOrigin + "/");
  expect(await historyIndex(page), "Star: the return to the homepage must go back in history").toBe(indexBefore - 1);
});

test("The star leads to the list, and does not go back, when the previous page is another article", async ({ page }) => {
  await page.goto(draftOrigin + articlePath);
  await settle(page);
  await page.locator("nav[aria-labelledby='more-writing'] a.entry-row").first().click();
  await expect(page).not.toHaveURL(draftOrigin + articlePath);
  await settle(page);
  const indexBefore = await historyIndex(page);
  await expect(readingStar(page).label).toHaveText("Writing");
  await readingStar(page).link.click();
  await expect(page).toHaveURL(draftOrigin + "/writing/");
  expect(await historyIndex(page), "Star: after another article the star must add a history entry").toBe(indexBefore + 1);
});

test("Escape follows the star", async ({ page }) => {
  await page.goto(draftOrigin + articlePath);
  await settle(page);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(draftOrigin + "/writing/");
});

test("Escape returns through history like the star after the homepage", async ({ page }) => {
  await page.goto(draftOrigin + "/");
  await settle(page);
  await page.locator("section.home-section[aria-labelledby='writing-label'] a.entry-row").first().click();
  await expect(page.locator("main h1")).not.toHaveText("Cristian Vega");
  await settle(page);
  const indexBefore = await historyIndex(page);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(draftOrigin + "/");
  expect(await historyIndex(page), "Escape: after the homepage it must go back in history").toBe(indexBefore - 1);
});

test("Escape does nothing with a modifier key, during composition, or in a field", async ({ page }) => {
  await page.goto(draftOrigin + articlePath);
  await settle(page);
  await recordNavigations(page);
  await page.evaluate(() => {
    const field = document.createElement("input");
    field.id = "probe-field";
    document.querySelector("main").prepend(field);
  });
  for (const modifiedEscape of ["Shift+Escape", "Control+Escape", "Alt+Escape", "Meta+Escape"]) {
    await page.keyboard.press(modifiedEscape);
  }
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: true })));
  await page.locator("#probe-field").focus();
  await page.keyboard.press("Escape");
  await page.locator("#probe-field").evaluate((field) => field.blur());
  // Keys that are not Escape must not move the page either.
  await page.keyboard.press("Enter");
  expect(await readNavigations(page), "Escape: no excluded key combination may start a navigation").toEqual([]);
  // A plain Escape from the page body still follows the star, so the recorder is live.
  await page.keyboard.press("Escape");
  expect(await readNavigations(page), "Escape: a plain Escape must start the navigation to the list").toEqual([{ destination: "/writing/", type: "push" }]);
});
