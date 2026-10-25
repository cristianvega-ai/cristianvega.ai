import { expect, test } from "@playwright/test";
import { homeSections, profileLinks } from "../shared/node-helpers.mjs";
import { currentContent, DRAFT_ORIGIN as draftOrigin, settle, useReducedMotion } from "../shared/browser-fixtures.mjs";

test("The skip link is the first stop and moves keyboard focus to the main content", async ({ page }) => {
  await useReducedMotion(page);
  await page.goto("/");
  await settle(page);
  await page.keyboard.press("Tab");
  const skipLink = page.locator("a.skip-link");
  await expect(skipLink, "Skip link: the first Tab must reach it").toBeFocused();
  await expect(skipLink).toHaveAttribute("href", "#main-content");
  await expect(skipLink, "Skip link: it must be on screen when it has focus").toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#main-content"), "Skip link: Enter must focus the main content").toBeFocused();
});

test("Tab visits the profiles, then each row and index link, and every stop shows a focus ring", async ({ page }) => {
  await useReducedMotion(page);
  await page.goto(draftOrigin + "/");
  await settle(page);
  const expectedStops = [
    ...profileLinks.map((profile) => profile.href),
    ...homeSections(currentContent, { includeDrafts: true }).flatMap((homeSection) => [...homeSection.rows.map((entry) => entry.href), homeSection.allHref]),
  ];
  expect(expectedStops.length, "The home page must hold at least one stop after the profiles").toBeGreaterThan(profileLinks.length);
  await page.keyboard.press("Tab");
  await expect(page.locator("a.skip-link")).toBeFocused();
  const visitedStops = [];
  for (const [stopIndex, expectedAddress] of expectedStops.entries()) {
    await page.keyboard.press("Tab");
    const focusedStop = await page.evaluate(() => {
      const focusedElement = document.activeElement;
      const focusStyle = getComputedStyle(focusedElement);
      return {
        href: focusedElement.getAttribute("href"),
        ring: focusedElement.matches(":focus-visible") && focusStyle.outlineStyle !== "none" && parseFloat(focusStyle.outlineWidth) >= 2,
      };
    });
    visitedStops.push(focusedStop.href);
    expect(focusedStop.ring, `Stop ${stopIndex + 1} (${expectedAddress}): the focused link must show a visible focus ring`).toBe(true);
  }
  expect(visitedStops, "Tab order: the links must follow the page order").toEqual(expectedStops);
  // The last index link ends the page, so the next Tab must leave the main content.
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.querySelector("main").contains(document.activeElement)), "Tab order: the page must hold no focus stop after the last index link").toBe(false);
});
