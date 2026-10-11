import { expect, test } from "@playwright/test";

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
