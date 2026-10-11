import { expect, test } from "@playwright/test";
import { expectReadablePage, VIEWPORTS as viewports } from "../shared/browser-fixtures.mjs";

test("A missing page returns HTTP 404 and provides home navigation", async ({ page }) => {
  const recordedPageProblems = [];
  page.on("pageerror", (error) => recordedPageProblems.push(error.message));
  page.on("console", (message) => {
    const expectedMissingPageError = message.location().url.endsWith("/missing-page-check/") && message.text().includes("404");
    if (message.type() === "error" && !expectedMissingPageError) recordedPageProblems.push(message.text());
  });
  const response = await page.goto("/missing-page-check/");
  expect(response.status()).toBe(404);
  await expect(page.locator("h1")).toBeVisible();
  await page.getByRole("link", { name: /home/i }).last().click();
  await expect(page.locator(".hero__name")).toBeVisible();
  expect(recordedPageProblems).toEqual([]);
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
