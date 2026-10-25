import { expect, test } from "@playwright/test";
import { homeSections, profileLinks } from "../shared/node-helpers.mjs";
import { currentContent, currentPublished, DRAFT_ORIGIN as draftOrigin, pageProblems, settle, tabTo, useReducedMotion } from "../shared/browser-fixtures.mjs";

test("Home shows sections and index links only for published content", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("a[href='#']")).toHaveCount(0);
  await expect(page.locator("nav, footer"), "Home: the page must have no menu or footer").toHaveCount(0);
  const expectedSections = homeSections(currentContent);
  await expect(page.locator("section.home-section")).toHaveCount(expectedSections.length);
  for (const homeSection of [{ section: "products", allHref: "/products/", label: "Products" }, { section: "lab", allHref: "/lab/", label: "Lab" }, { section: "writing", allHref: "/writing/", label: "Writing" }]) {
    const isPublished = currentPublished[homeSection.section].length > 0;
    await expect(page.locator(`a[href='${homeSection.allHref}']`), `${homeSection.label}: the index link must follow publication`).toHaveCount(isPublished ? 1 : 0);
    await expect(page.locator(`a[href^='/${homeSection.section}/']`), `${homeSection.label}: row and index links must follow publication`)
      .toHaveCount(isPublished ? 1 + expectedSections.find((expectedSection) => expectedSection.section === homeSection.section).rows.length : 0);
    expect((await request.get(homeSection.allHref)).status(), `${homeSection.allHref} must follow publication`).toBe(isPublished ? 200 : 404);
    for (const draft of currentContent[homeSection.section].filter((entry) => entry.data.draft)) {
      expect((await request.get(draft.href)).status(), `${draft.href} is a draft and must answer 404`).toBe(404);
      await expect(page.locator(`a[href='${draft.href}']`)).toHaveCount(0);
    }
  }
  await expect(page.locator("a[href^='/about']"), "Home: the page must not link to the retired About page").toHaveCount(0);
});

test("Home rows and index links open their pages with Enter and a click", async ({ page }) => {
  const recordedPageProblems = pageProblems(page);
  await useReducedMotion(page);
  await page.goto(draftOrigin + "/");
  await settle(page);
  const writingSection = homeSections(currentContent, { includeDrafts: true }).find((homeSection) => homeSection.section === "writing");
  const productSection = homeSections(currentContent, { includeDrafts: true }).find((homeSection) => homeSection.section === "products");

  const firstWritingRow = page.locator("section.home-section[aria-labelledby='writing-label'] a.entry-row").first();
  expect(await tabTo(page, "section.home-section[aria-labelledby='writing-label'] a.entry-row >> nth=0")).toBe(true);
  await expect(firstWritingRow).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(draftOrigin + writingSection.rows[0].href);
  await expect(page.locator("main h1")).toHaveText(writingSection.rows[0].data.title);

  await page.goto(draftOrigin + "/");
  await page.getByRole("link", { name: productSection.rows[0].data.title }).click();
  await expect(page).toHaveURL(draftOrigin + productSection.rows[0].href);

  await page.goto(draftOrigin + "/");
  await page.getByRole("link", { name: "All writing", exact: true }).click();
  await expect(page).toHaveURL(draftOrigin + "/writing/");
  await page.goto(draftOrigin + "/");
  await page.getByRole("link", { name: "All products", exact: true }).click();
  await expect(page).toHaveURL(draftOrigin + "/products/");
  expect(recordedPageProblems).toEqual([]);
});

test("Home profile links open the owner's profiles in new tabs that protect the opener", async ({ page }) => {
  await page.goto("/");
  for (const profile of profileLinks) {
    const profileLink = page.getByRole("link", { name: profile.name, exact: true });
    await expect(profileLink).toHaveAttribute("href", profile.href);
    await expect(profileLink).toHaveAttribute("target", "_blank");
    const relationship = await profileLink.getAttribute("rel");
    expect(relationship.split(/\s+/), `${profile.name}: the link must protect the opener`).toEqual(expect.arrayContaining(["noopener", "noreferrer"]));
  }
});
