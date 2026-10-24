import { expect, test } from "@playwright/test";
import { DRAFT_ORIGIN as draftOrigin, dispatchPageTransition, pendingFrames, playFrames, readingStar, settle, useManualFrames, useReducedMotion } from "../shared/browser-fixtures.mjs";

// The browser can keep a page in its cache. The star must stop its work on pagehide and start it again on pageshow.
// The cases fire both events by hand, because Playwright does not enter the cache.
const articlePath = "/writing/full-article-layout-fixture/";

test.beforeEach(async ({ page }) => {
  await useReducedMotion(page);
  await useManualFrames(page);
});

const readHiddenShares = (page) =>
  readingStar(page).lines.evaluateAll((lines) => lines.map((line) => Number.parseFloat(line.style.strokeDashoffset)));

/** Record each navigation that the page starts and cancel it when the browser allows. */
const recordNavigations = (page) =>
  page.evaluate(() => {
    window.__navigations = [];
    navigation.addEventListener("navigate", (event) => {
      window.__navigations.push(new URL(event.destination.url).pathname);
      if (event.cancelable) event.preventDefault();
    });
  });
const readNavigations = (page) => page.evaluate(() => window.__navigations);

const scrollInstantly = (page, top) => page.evaluate((scrollTop) => scrollTo({ top: scrollTop, behavior: "instant" }), top);

async function openArticle(page) {
  await page.goto(draftOrigin + articlePath);
  await settle(page);
  await playFrames(page, 100);
  // Wait for the star script to run: the first measure draws the lines at the top of the page.
  await expect.poll(() => readHiddenShares(page)).toEqual(Array(6).fill(1));
  await recordNavigations(page);
}

test("A scroll queues one frame, and the frame draws the figure", async ({ page }) => {
  await openArticle(page);
  expect(await pendingFrames(page), "Star: a page at rest must hold no queued frame").toBe(0);
  await scrollInstantly(page, 600);
  await expect.poll(() => pendingFrames(page), { message: "Star: a scroll must queue one frame" }).toBe(1);
  await scrollInstantly(page, 700);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(700);
  expect(await pendingFrames(page), "Star: more scroll events before the frame must not queue more frames").toBe(1);
  await playFrames(page, 32);
  expect((await readHiddenShares(page))[0], "Star: the frame must draw the first line").toBeLessThan(1);
  expect(await pendingFrames(page), "Star: a drawn frame must leave nothing queued").toBe(0);
});

test("Pagehide cancels the queued frame and stops the scroll, resize, and Escape listeners", async ({ page }) => {
  await openArticle(page);
  await scrollInstantly(page, 600);
  await expect.poll(() => pendingFrames(page)).toBe(1);

  await dispatchPageTransition(page, "pagehide");
  expect(await pendingFrames(page), "Star: pagehide must cancel the queued frame").toBe(0);

  const hiddenSharesAtPagehide = await readHiddenShares(page);
  await scrollInstantly(page, 1400);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(1400);
  expect(await pendingFrames(page), "Star: a scroll after pagehide must queue no frame").toBe(0);
  await page.setViewportSize({ width: 1000, height: 700 });
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(1000);
  expect(await readHiddenShares(page), "Star: a resize after pagehide must not redraw the figure").toEqual(hiddenSharesAtPagehide);
  await page.keyboard.press("Escape");
  expect(await readNavigations(page), "Star: Escape after pagehide must start no navigation").toEqual([]);
});

test("Pageshow from the cache starts the listeners again", async ({ page }) => {
  await openArticle(page);
  await dispatchPageTransition(page, "pagehide");
  await scrollInstantly(page, 1200);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(1200);
  expect(await pendingFrames(page)).toBe(0);

  await dispatchPageTransition(page, "pageshow", true);
  // The restart measures the page and draws the current scroll position at once.
  const hiddenShares = await readHiddenShares(page);
  expect(hiddenShares[0], "Star: pageshow must draw the figure for the current scroll position").toBeLessThan(1);
  await scrollInstantly(page, 1500);
  await expect.poll(() => pendingFrames(page), { message: "Star: a scroll after pageshow must queue a frame" }).toBe(1);
  await playFrames(page, 32);
  await page.keyboard.press("Escape");
  expect(await readNavigations(page), "Star: Escape after pageshow must follow the star").toEqual(["/writing/"]);
});

test("A pageshow that does not come from the cache leaves a stopped star stopped", async ({ page }) => {
  await openArticle(page);
  await dispatchPageTransition(page, "pagehide");
  await dispatchPageTransition(page, "pageshow", false);
  await scrollInstantly(page, 600);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(600);
  expect(await pendingFrames(page), "Star: a pageshow with persisted false must not restart the scroll listener").toBe(0);
  await page.keyboard.press("Escape");
  expect(await readNavigations(page), "Star: a pageshow with persisted false must not restart the Escape listener").toEqual([]);
});

test("The star keeps working after repeated pagehide and pageshow cycles", async ({ page }) => {
  await openArticle(page);
  for (let cycle = 0; cycle < 3; cycle += 1) {
    await dispatchPageTransition(page, "pagehide");
    await dispatchPageTransition(page, "pageshow", true);
  }
  await scrollInstantly(page, 600);
  await expect.poll(() => pendingFrames(page), { message: "Star: after three cycles one scroll must queue one frame" }).toBe(1);
  await playFrames(page, 32);
  await page.keyboard.press("Escape");
  expect(await readNavigations(page), "Star: after three cycles Escape must follow the star").toEqual(["/writing/"]);
});
