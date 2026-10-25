import { expect } from "@playwright/test";
import { dispatchPageTransition, labTest as test, settle, stubSceneBodies } from "../shared/browser-fixtures.mjs";

// On pagehide the clips pause and the observer stops. A page that returns from the cache plays the clips again, all together.

test.beforeEach(async ({ page }) => {
  await stubSceneBodies(page);
});

const clipStates = (page) => page.evaluate(() => [...document.querySelectorAll("ul#results video[data-clip]")].map((clip) => !clip.paused));
const waitForFrames = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

test("The clips pause on pagehide, stay paused when scrolled, and play again when the page returns from the cache", async ({ page, lab }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(lab.origin + lab.experiment.href);
  await settle(page);
  const clips = page.locator("ul#results video[data-clip]");
  await clips.first().evaluate((clip) => clip.scrollIntoView({ block: "center", behavior: "instant" }));
  await expect.poll(async () => (await clipStates(page))[0], { message: "Lifecycle: the clip on screen must play", timeout: 20_000 }).toBe(true);

  await dispatchPageTransition(page, "pagehide");
  await expect.poll(async () => (await clipStates(page)).some(Boolean), { message: "Lifecycle: pagehide must pause every clip" }).toBe(false);

  // The observer has stopped, so a clip that scrolls into view must stay paused.
  await clips.nth(1).evaluate((clip) => clip.scrollIntoView({ block: "center", behavior: "instant" }));
  await waitForFrames(page);
  await waitForFrames(page);
  expect(await clipStates(page), "Lifecycle: no clip may play after pagehide").toEqual(lab.results.map(() => false));

  // A page that returns from the cache plays the clips again. They play together, so the clips off screen play too.
  await dispatchPageTransition(page, "pageshow", true);
  await expect.poll(async () => (await clipStates(page)).every(Boolean), { message: "Lifecycle: pageshow from the cache must play every clip together", timeout: 20_000 }).toBe(true);
});

test("A pageshow that does not come from the cache does not start the clips again", async ({ page, lab }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(lab.origin + lab.experiment.href);
  await settle(page);
  await page.locator("ul#results video[data-clip]").first().evaluate((clip) => clip.scrollIntoView({ block: "center", behavior: "instant" }));
  await expect.poll(async () => (await clipStates(page))[0], { timeout: 20_000 }).toBe(true);
  await dispatchPageTransition(page, "pagehide");
  await expect.poll(async () => (await clipStates(page)).some(Boolean)).toBe(false);
  await dispatchPageTransition(page, "pageshow", false);
  await waitForFrames(page);
  await waitForFrames(page);
  expect(await clipStates(page), "Lifecycle: a fresh pageshow must not restart the observer").toEqual(lab.results.map(() => false));
});
