import { expect } from "@playwright/test";
import { labTest as test, settle, stubSceneBodies, useReducedMotion, VIEWPORTS as viewports } from "../shared/browser-fixtures.mjs";

// The page transitions of the Lab. The browser draws the motion. These tests check the names that travel and the scroll position that the return restores.

test.beforeEach(async ({ page }) => {
  await stubSceneBodies(page);
});

/** Stop every click from navigating after the page scripts have handled it. This listener runs last. */
const keepPageInPlace = (page) => page.evaluate(() => document.addEventListener("click", (event) => event.preventDefault()));
const transitionName = (locator) => locator.evaluate((element) => getComputedStyle(element).viewTransitionName);

test("A click on a result clip gives the clip the stage name and releases the page heading", async ({ page, lab }) => {
  await page.goto(lab.origin + lab.experiment.href);
  await settle(page);
  await keepPageInPlace(page);
  const tile = page.locator("ul#results a.result-tile").nth(1);
  await tile.click();
  await expect(tile.locator("[data-stage-media]")).toHaveCSS("view-transition-name", "stage");
  await expect(page.locator("h1[data-morph-title]"), "Experiment: the heading must let its name go, so only one element has a name").toHaveCSS("view-transition-name", "none");
  const stageNames = await page.locator("[data-stage-media]").evaluateAll((elements) => elements.map((element) => getComputedStyle(element).viewTransitionName));
  expect(stageNames.filter((name) => name === "stage"), "Experiment: exactly one clip may hold the stage name").toHaveLength(1);

  // A click on another clip moves the name.
  const otherTile = page.locator("ul#results a.result-tile").nth(5);
  await otherTile.click();
  await expect(otherTile.locator("[data-stage-media]")).toHaveCSS("view-transition-name", "stage");
  expect(await transitionName(tile.locator("[data-stage-media]")), "Experiment: the earlier clip must give the name up").not.toBe("stage");
});

test("A click on an experiment card gives its title the title name", async ({ page, lab }) => {
  await page.goto(`${lab.origin}/lab/`);
  await settle(page);
  await keepPageInPlace(page);
  await page.locator("a.lab-card").click();
  await expect(page.locator("a.lab-card .lab-card__title")).toHaveCSS("view-transition-name", "title");
  await expect(page.locator("h1[data-morph-title]")).toHaveCSS("view-transition-name", "none");
});

test("A click on a scene arrow stores its direction for the next scene", async ({ page, lab }) => {
  const sceneAddress = (resultIndex) => `${lab.origin}${lab.experiment.href}${lab.results[resultIndex].slug}/`;
  await page.goto(sceneAddress(1));
  await settle(page);
  // The viewer steps with location.replace, so a click guard cannot hold the page. Answer the step with 204 No Content,
  // which ends the navigation and keeps this page. Otherwise the next scene can open and read the direction before this test does.
  await page.route(sceneAddress(2), (route) => route.fulfill({ status: 204 }));
  await page.route(sceneAddress(0), (route) => route.fulfill({ status: 204 }));
  await page.locator("a[data-direction='next']").click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("stage-direction")), { message: "Scene: the next arrow must store its direction" }).toBe("next");
  await page.locator("a[data-direction='previous']").click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("stage-direction")), { message: "Scene: the previous arrow must store its direction" }).toBe("previous");
});

// The viewer returns to the experiment page. The matching clip must scroll into view, with and without the page transition.
for (const reducedMotion of ["no-preference", "reduce"]) {
  test(`The experiment scrolls the returning clip into view with ${reducedMotion === "reduce" ? "reduced motion" : "page transitions"}`, async ({ page, lab }) => {
    await page.setViewportSize(viewports.mobile);
    await useReducedMotion(page, reducedMotion);
    await page.goto(lab.origin + lab.experiment.href);
    await settle(page);
    expect(await page.evaluate(() => history.scrollRestoration), "Experiment: the browser must not restore an older scroll position").toBe("manual");
    const lastTile = page.locator("ul#results a.result-tile").last();
    const lastResult = lab.results.at(-1);
    await lastTile.scrollIntoViewIfNeeded();
    await lastTile.click();
    await expect(page).toHaveURL(`${lab.origin}${lab.experiment.href}${lastResult.slug}/`);
    await settle(page);
    await page.goBack();
    await expect(page).toHaveURL(lab.origin + lab.experiment.href);
    const media = page.locator(`a[data-stage-key='${lastResult.slug}'] [data-stage-media]`);
    await expect.poll(() => media.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return box.top >= 0 && box.bottom <= innerHeight;
    }), { message: "Experiment: the clip that the visitor left must be fully visible on return" }).toBe(true);
  });
}
