import { expect, test } from "@playwright/test";
import { currentContent, DRAFT_ORIGIN as draftOrigin, expectReadablePage, pageProblems, settle, useReducedMotion, VIEWPORTS as viewports } from "../shared/browser-fixtures.mjs";

// Each principle has a star in the margin, level with the first line of its statement.
// On a narrow screen the margin is only the gutter, so the star must still sit inside the viewport.
const principles = currentContent.principles;

for (const [viewportName, viewport] of Object.entries(viewports)) {
  test(`Each principle star sits in the margin, level with its statement, at ${viewport.width}px`, async ({ page }) => {
    const recordedPageProblems = pageProblems(page);
    await page.setViewportSize(viewport);
    await useReducedMotion(page);
    await page.goto(draftOrigin + "/principles/");
    await settle(page);
    await expectReadablePage(page);
    for (const principle of principles) {
      const block = page.locator(`[id="${principle.id}"]`);
      const [starBox, textBox] = await Promise.all([block.locator("a.principle__star").boundingBox(), block.locator(".principle__text").boundingBox()]);
      const firstLineHeight = await block.locator(".principle__statement").evaluate((statement) => parseFloat(getComputedStyle(statement).lineHeight));
      expect(starBox.x, `${principle.id} at ${viewportName}: the star must start inside the viewport`).toBeGreaterThanOrEqual(0);
      expect(starBox.x + starBox.width, `${principle.id} at ${viewportName}: the star must end before the statement`).toBeLessThanOrEqual(textBox.x);
      expect(Math.abs(starBox.y + starBox.height / 2 - (textBox.y + firstLineHeight / 2)), `${principle.id} at ${viewportName}: the star must sit level with the first line`).toBeLessThanOrEqual(3);
    }
    expect(recordedPageProblems).toEqual([]);
  });
}
