import { expect, test } from "@playwright/test";
import { homeSections, homeSectionSize, profileLinks } from "../shared/node-helpers.mjs";
import { currentContent, DRAFT_ORIGIN as draftOrigin, expectReadablePage, pageProblems, settle, useReducedMotion, VIEWPORTS as viewports } from "../shared/browser-fixtures.mjs";

// The draft server lists drafts, so the sections hold the newest entries of every fixture.
const expectedSections = homeSections(currentContent, { includeDrafts: true });

// Products, Lab and Writing sit side by side from this width up.
const gridWidth = 860;

// Check the widths where the page column, the profile row, the grid, and the entry rows change.
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

    // The parts must read in order: the identity, the bio, the profiles, then the sections.
    const readBoxes = (selectors) => page.evaluate((partSelectors) => partSelectors.map((selector) => {
      const box = document.querySelector(selector).getBoundingClientRect();
      return { top: box.top, left: box.left, width: box.width };
    }), selectors);
    const partTops = (await readBoxes(["header.identity", "p.bio", "ul.profile-links", "#products-label"])).map((box) => box.top);
    expect(partTops, `Home at ${viewportName}: the parts must stack from the identity down to the sections`).toEqual([...partTops].sort((first, second) => first - second));
    expect(new Set(partTops).size, `Home at ${viewportName}: no two parts may share a top edge`).toBe(partTops.length);
    const [bioBox] = await readBoxes(["p.bio"]);
    expect(bioBox.width, `Home at ${viewportName}: the bio must keep the reading width`).toBeLessThanOrEqual(576);
    const gridLabels = await readBoxes(["#products-label", "#lab-label", "#writing-label"]);
    if (viewport.width >= gridWidth) {
      // The three sections share one row, left to right, and the row starts on the left edge of the bio.
      for (const label of gridLabels) expect(Math.abs(label.top - gridLabels[0].top), `Home at ${viewportName}: the three sections must share a top edge`).toBeLessThanOrEqual(1);
      expect(gridLabels.map((label) => label.left), `Home at ${viewportName}: the sections must read left to right`).toEqual([...gridLabels.map((label) => label.left)].sort((first, second) => first - second));
      expect(Math.abs(gridLabels[0].left - bioBox.left), `Home at ${viewportName}: the sections must start on the left edge of the bio`).toBeLessThanOrEqual(1);
      expect(gridLabels[2].left - gridLabels[0].left, `Home at ${viewportName}: the sections must spread wider than the reading column`).toBeGreaterThan(bioBox.width / 2);
    } else {
      const gridTops = gridLabels.map((label) => label.top);
      expect(gridTops, `Home at ${viewportName}: the sections must stack in order`).toEqual([...gridTops].sort((first, second) => first - second));
      expect(new Set(gridTops).size, `Home at ${viewportName}: no two sections may share a top edge`).toBe(gridTops.length);
    }
    expect(recordedPageProblems).toEqual([]);
  });
}
