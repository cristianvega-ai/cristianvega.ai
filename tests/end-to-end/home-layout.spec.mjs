import { expect, test } from "@playwright/test";
import { homeSections, homeSectionSize, profileLinks } from "../shared/node-helpers.mjs";
import { currentContent, DRAFT_ORIGIN as draftOrigin, expectReadablePage, pageProblems, settle, useReducedMotion, VIEWPORTS as viewports } from "../shared/browser-fixtures.mjs";

// The draft server lists drafts, so the sections hold the newest entries of every fixture.
const expectedSections = homeSections(currentContent, { includeDrafts: true });

// Check the widths where the page column, the profile row, and the entry rows change.
for (const [viewportName, viewport] of Object.entries({ desktop: viewports.desktop, tablet: viewports.tablet, mobile: viewports.mobile })) {
  test(`Home shows the identity, bio, profiles, and sections in order at ${viewport.width}px`, async ({ page }) => {
    const recordedPageProblems = pageProblems(page);
    await page.setViewportSize(viewport);
    await useReducedMotion(page);
    await page.goto(draftOrigin + "/");
    await settle(page);
    await expectReadablePage(page);

    await expect(page.locator("main h1")).toHaveText("Cristian Vega");
    await expect(page.locator("header.identity .identity__role")).not.toBeEmpty();
    await expect(page.locator("header.identity svg.mark")).toBeVisible();
    await expect(page.locator("p.bio")).toBeVisible();

    const profileAnchors = page.locator("ul.profile-links[aria-label='Profiles'] a");
    await expect(profileAnchors).toHaveCount(profileLinks.length);
    for (const [profileIndex, profile] of profileLinks.entries()) {
      const profileAnchor = profileAnchors.nth(profileIndex);
      await expect(profileAnchor, `Profile ${profile.name}: the link must keep its accessible name`).toHaveAccessibleName(profile.name);
      await expect(profileAnchor).toHaveAttribute("href", profile.href);
      await expect(profileAnchor).toBeVisible();
      const targetBox = await profileAnchor.boundingBox();
      expect(Math.min(targetBox.width, targetBox.height), `Profile ${profile.name}: the touch target must reach 32 pixels`).toBeGreaterThanOrEqual(32);
    }

    // The sections follow the content: the heading, at most four rows, and the link to the index.
    expect(expectedSections.map((expectedSection) => expectedSection.section), "The draft fixtures must fill the three homepage sections").toEqual(["products", "lab", "writing"]);
    const sections = page.locator("section.home-section");
    await expect(sections).toHaveCount(expectedSections.length);
    for (const [sectionIndex, expectedSection] of expectedSections.entries()) {
      const section = sections.nth(sectionIndex);
      await expect(section.getByRole("heading", { level: 2 })).toHaveText(expectedSection.label);
      await expect(section).toHaveAttribute("aria-labelledby", expectedSection.headingId);
      const rows = section.locator("ul.entry-list > li > a.entry-row");
      await expect(rows).toHaveCount(expectedSection.rows.length);
      expect(expectedSection.rows.length, `${expectedSection.label}: a section must show at most ${homeSectionSize} rows`).toBeLessThanOrEqual(homeSectionSize);
      expect(await rows.evaluateAll((links) => links.map((link) => link.getAttribute("href"))), `${expectedSection.label}: rows must list the newest entries first`)
        .toEqual(expectedSection.rows.map((entry) => entry.href));
      expect(await rows.locator(".entry-row__title").allTextContents()).toEqual(expectedSection.rows.map((entry) => entry.data.title));
      expect(await rows.evaluateAll((links) => links.map((link) => link.dataset.morphKey)), `${expectedSection.label}: each row must carry its transition key`)
        .toEqual(expectedSection.rows.map((entry) => `${expectedSection.section}/${entry.id}`));
      for (const row of await rows.all()) {
        const rowBox = await row.boundingBox();
        expect(rowBox.x, `${expectedSection.label}: a row must start inside the viewport`).toBeGreaterThanOrEqual(0);
        expect(rowBox.x + rowBox.width, `${expectedSection.label}: a row must end inside the viewport`).toBeLessThanOrEqual(viewport.width);
      }
      // A writing row ends with its date, a Lab row ends with its model count, and a product row holds a description.
      if (expectedSection.section === "products") await expect(rows.locator(".entry-row__description")).toHaveCount(expectedSection.rows.length);
      else await expect(rows.locator(".entry-row__meta")).toHaveCount(expectedSection.rows.length);
      await expect(rows.locator(".entry-row__draft")).toHaveCount(expectedSection.rows.filter((entry) => entry.data.draft).length);
      const allLink = section.locator("a.home-section__all");
      await expect(allLink).toHaveText(expectedSection.allLabel);
      await expect(allLink).toHaveAttribute("href", expectedSection.allHref);
    }

    // The parts must read in order: the identity, the bio, the profiles, then each section.
    const partTops = await page.evaluate(() => ["header.identity", "p.bio", "ul.profile-links", "#products-label", "#lab-label", "#writing-label"]
      .map((selector) => document.querySelector(selector).getBoundingClientRect().top));
    expect(partTops, `Home at ${viewportName}: the parts must stack from the identity down to the last section`).toEqual([...partTops].sort((first, second) => first - second));
    expect(new Set(partTops).size, `Home at ${viewportName}: no two parts may share a top edge`).toBe(partTops.length);
    expect(recordedPageProblems).toEqual([]);
  });
}
