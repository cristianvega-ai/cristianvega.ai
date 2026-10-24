import { expect, test } from "@playwright/test";
import { readingStar, settle } from "../shared/browser-fixtures.mjs";

const missingPath = "/missing-page-check/";

async function openMissingPage(page) {
  const recordedPageProblems = [];
  page.on("pageerror", (error) => recordedPageProblems.push(error.message));
  page.on("console", (message) => {
    const expectedMissingPageError = message.location().url.endsWith(missingPath) && message.text().includes("404");
    if (message.type() === "error" && !expectedMissingPageError) recordedPageProblems.push(message.text());
  });
  const response = await page.goto(missingPath);
  expect(response.status()).toBe(404);
  await settle(page);
  return recordedPageProblems;
}

test("A missing page returns HTTP 404 and the home page link in its lede leads home", async ({ page }) => {
  const recordedPageProblems = await openMissingPage(page);
  await expect(page.locator("main h1")).toHaveText("This page doesn't exist.");
  await page.locator(".detail__lede").getByRole("link", { name: "home page" }).click();
  await expect(page.locator("h1.identity__name")).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/");
  expect(recordedPageProblems).toEqual([]);
});

test("A missing page offers the reading star as a second way home", async ({ page }) => {
  const recordedPageProblems = await openMissingPage(page);
  const { link, label } = readingStar(page);
  await expect(label).toHaveText("Home");
  await expect(link).toHaveAttribute("href", "/");
  await link.click();
  await expect(page.locator("h1.identity__name")).toBeVisible();
  expect(recordedPageProblems).toEqual([]);
});
