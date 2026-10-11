import { expect, test } from "@playwright/test";
import { currentContent, currentPublished, DRAFT_ORIGIN as draftOrigin, latestWork, navigationLink, pageProblems, settle, tabTo, useReducedMotion } from "../shared/browser-fixtures.mjs";

test("Home opens About and returns through the brand link", async ({ page }) => {
  await page.goto("/");
  await navigationLink(page, "about").click();
  await expect(page).toHaveURL(/\/about\/$/);
  await expect(page.locator(".about__profile")).toBeVisible();
  await page.getByRole("link", { name: "Cristian Vega home" }).click();
  await expect(page.locator(".hero__name")).toBeVisible();
});

test("Home shows links only for published sections", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("main h2")).toHaveCount(0);
  await expect(page.locator("[data-article-identifier], [data-product-identifier]")).toHaveCount(0);
  await expect(page.locator("a[href='#']")).toHaveCount(0);

  const latestWorkItems = page.locator(".hero__next-item");
  const publishedSections = latestWork.map((latestWorkLink) => currentPublished[latestWorkLink.section].length > 0);
  await expect(latestWorkItems).toHaveText(latestWork.map((latestWorkLink, sectionIndex) => publishedSections[sectionIndex] ? `${latestWorkLink.label} →` : latestWorkLink.soon));
  expect(await latestWorkItems.evaluateAll((nodes) => nodes.map((node) => node.dataset.state))).toEqual(publishedSections.map((isPublished) => isPublished ? "live" : "soon"));
  const focusableControlCount = await page.locator(".hero__next").evaluate((list) => list.querySelectorAll("a, button, [tabindex]").length);
  expect(focusableControlCount).toBe(publishedSections.filter(Boolean).length);
  for (const [sectionIndex, latestWorkLink] of latestWork.entries()) {
    await expect(page.locator(`.navigation__link[href='${latestWorkLink.href}'], .navigation-menu__link[href='${latestWorkLink.href}']`)).toHaveCount(publishedSections[sectionIndex] ? 2 : 0);
    await expect(page.locator(`a[href^='/${latestWorkLink.section}']`)).toHaveCount(publishedSections[sectionIndex] ? 3 : 0);
    await expect(latestWorkItems.nth(sectionIndex).locator("a")).toHaveCount(publishedSections[sectionIndex] ? 1 : 0);
    if (publishedSections[sectionIndex]) await expect(latestWorkItems.nth(sectionIndex).locator("a")).toHaveAttribute("href", latestWorkLink.href);
    expect((await request.get(latestWorkLink.href)).status()).toBe(publishedSections[sectionIndex] ? 200 : 404);
    for (const draft of currentContent[latestWorkLink.section].filter((entry) => entry.data.draft)) {
      expect((await request.get(draft.href)).status(), draft.href).toBe(404);
    }
  }
});

test("Home preview links accept keyboard focus and open writing and products", async ({ page }) => {
  const recordedPageProblems = pageProblems(page);
  await useReducedMotion(page);
  await page.goto(draftOrigin + "/");
  await settle(page);
  const writingLink = page.getByRole("link", { name: "Read my latest writing", exact: true });
  const productsLink = page.getByRole("link", { name: "See my latest products", exact: true });
  await expect(writingLink).toHaveAttribute("href", "/writing/");
  await expect(productsLink).toHaveAttribute("href", "/products/");
  expect(await tabTo(page, ".hero__next a[href='/writing/']")).toBe(true);
  expect(await writingLink.evaluate((link) => {
    const linkStyle = getComputedStyle(link);
    return link.matches(":focus-visible") && linkStyle.outlineStyle !== "none" && parseFloat(linkStyle.outlineWidth) >= 2;
  }), "The writing link must show a visible keyboard focus ring").toBe(true);
  await page.keyboard.press("Enter");
  await expect(page.locator("#writing-title")).toBeVisible();
  await page.goto(draftOrigin + "/");
  await productsLink.click();
  await expect(page.locator("#products-title")).toBeVisible();
  expect(recordedPageProblems).toEqual([]);
});
