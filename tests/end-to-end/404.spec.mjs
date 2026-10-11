import { expect, test } from "@playwright/test";
import { expectReadablePage, VIEWPORTS } from "../support/browser-fixtures.mjs";

test("a missing page reports 404 and returns the reader home", async ({ page }) => {
  const problems = [];
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("console", (message) => {
    const missingPage = message.location().url.endsWith("/missing-page-check/") && message.text().includes("404");
    if (message.type() === "error" && !missingPage) problems.push(message.text());
  });
  const response = await page.goto("/missing-page-check/");
  expect(response.status()).toBe(404);
  await expect(page.locator("h1")).toBeVisible();
  await page.getByRole("link", { name: /home/i }).last().click();
  await expect(page.locator(".hero__name")).toBeVisible();
  expect(problems).toEqual([]);
});

test("a missing page stays readable without JavaScript", async ({ browser, baseURL: baseAddress }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: VIEWPORTS.mobile });
  try {
    const page = await context.newPage();
    const response = await page.goto(new URL("/missing-page-check/", baseAddress).href);
    expect(response.status()).toBe(404);
    await expect(page.locator("[data-graphic='404']")).toBeHidden();
    await expectReadablePage(page);
  } finally {
    await context.close();
  }
});
