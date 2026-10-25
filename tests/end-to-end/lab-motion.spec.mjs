import { expect } from "@playwright/test";
import { labTest as test, pageProblems, settle, stubSceneBodies, useReducedMotion } from "../shared/browser-fixtures.mjs";

// The Lab clips are muted loops. They start together, play while at least one clip is on screen, pause together, and stop with the pause control.
// They never seek, because Cloudflare's static assets do not answer byte ranges, so playing together is what keeps them in step.
// Playwright's Chromium plays the AV1 source of each clip, so the clips run for real here.

// The result grid has two columns at 1440 pixels. This height keeps all eight tiles on screen, so all eight clips can play.
const tallViewport = { width: 1440, height: 2200 };

// The largest distance in seconds between two clips that play together.
const stepTolerance = 0.25;

test.beforeEach(async ({ page }) => {
  await stubSceneBodies(page);
});

// The article comes before the results, so the results start below the first screen. Scroll them in before a test reads the clips.
const showResults = (page) => page.locator("ul#results").evaluate((grid) => grid.scrollIntoView({ block: "start", behavior: "instant" }));

const clipsOf = (page) => page.locator("ul#results video[data-clip]");

/** Read the playback state of every clip in one page call, so the readings are as close in time as possible. */
const readClips = (page) => page.evaluate(() => [...document.querySelectorAll("ul#results video[data-clip]")].map((clip) => ({
  paused: clip.paused, time: clip.currentTime, duration: clip.duration, ready: clip.readyState,
})));

/** The shortest distance between two playback times on a loop of the given length. */
const loopDistance = (firstTime, secondTime, loopLength) => {
  const gap = Math.abs(firstTime - secondTime) % loopLength;
  return Math.min(gap, loopLength - gap);
};

/** Wait for two animation frames, so a paused clip has the chance to move if it would. */
const waitForFrames = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function expectClipsInStep(page, message) {
  const clips = await readClips(page);
  expect(clips.every((clip) => clip.duration > 0), `${message}: every clip must know its length`).toBe(true);
  const [reference] = clips;
  for (const clip of clips) {
    expect(Math.abs(clip.duration - reference.duration), `${message}: the clips of a group must have the same length`).toBeLessThan(0.1);
    expect(loopDistance(clip.time, reference.time, reference.duration), `${message}: each clip must stay within ${stepTolerance} s of the others`).toBeLessThanOrEqual(stepTolerance);
  }
}

test("The clips of the experiment play, and the playing clips stay within 0.25 s of each other", async ({ page, lab }) => {
  const recordedPageProblems = pageProblems(page);
  await page.setViewportSize(tallViewport);
  await page.goto(lab.origin + lab.experiment.href);
  await settle(page);
  await showResults(page);
  const clips = clipsOf(page);
  await expect(clips).toHaveCount(lab.results.length);
  expect(await page.evaluate(() => document.createElement("video").canPlayType('video/mp4; codecs="av01.0.04M.08"')), "Chromium must play the AV1 source of the clips").not.toBe("");
  await expect.poll(async () => (await readClips(page)).filter((clip) => !clip.paused && clip.time > 0).length, {
    message: "Clips: every clip on screen must play",
    timeout: 20_000,
  }).toBe(lab.results.length);
  await expect(page.locator("button[data-clip-pause]").first()).toHaveText("Pause clips");
  // Poll the spread, because the clips start together only once all of them have loaded.
  await expect.poll(async () => {
    const readings = await readClips(page);
    return Math.max(...readings.map((clip) => loopDistance(clip.time, readings[0].time, readings[0].duration)));
  }, { message: "Clips: all clips must play in step", timeout: 20_000 }).toBeLessThanOrEqual(stepTolerance);
  await expectClipsInStep(page, "Clips");
  expect(recordedPageProblems).toEqual([]);
});

test("The clips play while one clip is on screen and pause together when none is", async ({ page, lab }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(lab.origin + lab.experiment.href);
  await settle(page);
  const clips = clipsOf(page);
  const allPlaying = async () => (await readClips(page)).every((clip) => !clip.paused && clip.time > 0);
  const allPaused = async () => (await readClips(page)).every((clip) => clip.paused);

  expect(await allPaused(), "Clips: with no clip on screen, every clip must stay paused").toBe(true);
  await clips.first().evaluate((clip) => clip.scrollIntoView({ block: "center", behavior: "instant" }));
  await expect.poll(allPlaying, { message: "Clips: one clip on screen must start every clip, including those below the screen", timeout: 20_000 }).toBe(true);
  await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
  await expect.poll(allPaused, { message: "Clips: with every clip off screen, every clip must pause" }).toBe(true);
});

test("A clip with 10 percent on screen does not start the clips, and one with 30 percent does", async ({ page, lab }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(lab.origin + lab.experiment.href);
  await settle(page);
  // The first row sits under the article, so only that row can reach the bottom edge of the viewport.
  const firstClip = clipsOf(page).first();
  // Scroll so that the given share of the clip height is above the bottom edge of the viewport.
  const scrollToShare = (share) => firstClip.evaluate((clip, visibleShare) => {
    const box = clip.getBoundingClientRect();
    scrollBy({ top: box.top + box.height * visibleShare - innerHeight, behavior: "instant" });
  }, share);
  const anyPlaying = async () => (await readClips(page)).some((clip) => !clip.paused);
  await firstClip.evaluate((clip) => clip.scrollIntoView({ block: "center", behavior: "instant" }));
  await expect.poll(anyPlaying, { timeout: 20_000 }).toBe(true);
  await scrollToShare(0.1);
  await expect.poll(anyPlaying, { message: "Clips: a clip with 10 percent on screen must not keep the clips playing" }).toBe(false);
  await waitForFrames(page);
  expect(await anyPlaying(), "Clips: with 10 percent of a clip on screen, the clips must stay paused").toBe(false);
  await scrollToShare(0.3);
  await expect.poll(anyPlaying, { message: "Clips: a clip with 30 percent on screen must start the clips", timeout: 20_000 }).toBe(true);
});

test("The pause control stops every clip and starts them again in step", async ({ page, lab }) => {
  await page.setViewportSize(tallViewport);
  await page.goto(lab.origin + lab.experiment.href);
  await settle(page);
  await showResults(page);
  const control = page.locator("button[data-clip-pause]").first();
  await expect.poll(async () => (await readClips(page)).every((clip) => !clip.paused && clip.time > 0), { timeout: 20_000 }).toBe(true);

  await control.click();
  await expect(control).toHaveText("Play clips");
  await expect.poll(async () => (await readClips(page)).every((clip) => clip.paused), { message: "Pause control: every clip must pause" }).toBe(true);
  const pausedTimes = (await readClips(page)).map((clip) => clip.time);
  await waitForFrames(page);
  expect((await readClips(page)).map((clip) => clip.time), "Pause control: a paused clip must hold its frame").toEqual(pausedTimes);

  await control.click();
  await expect(control).toHaveText("Pause clips");
  await expect.poll(async () => (await readClips(page)).every((clip) => !clip.paused), { message: "Pause control: every clip must play again", timeout: 20_000 }).toBe(true);
  await expect.poll(async () => {
    const readings = await readClips(page);
    return Math.max(...readings.map((clip) => loopDistance(clip.time, readings[0].time, readings[0].duration)));
  }, { message: "Pause control: the clips must restart in step", timeout: 20_000 }).toBeLessThanOrEqual(stepTolerance);
});

test.describe("with reduced motion", () => {
  test.beforeEach(async ({ page }) => {
    await useReducedMotion(page);
  });

  test("The clips hold their posters until the visitor plays them", async ({ page, lab }) => {
    await page.setViewportSize(tallViewport);
    await page.goto(lab.origin + lab.experiment.href);
    await settle(page);
    await showResults(page);
    const control = page.locator("button[data-clip-pause]").first();
    await expect(control, "Reduced motion: the control must offer to play").toHaveText("Play clips");
    await expect(control).toBeVisible();
    const clips = clipsOf(page);
    await expect(clips).toHaveCount(lab.results.length);
    expect(await clips.evaluateAll((elements) => elements.map((clip) => clip.getAttribute("poster"))), "Reduced motion: each clip must hold its poster")
      .toEqual(lab.results.map((result) => `/lab/media/${lab.experiment.id}/posters/${result.slug}.webp`));
    // Give a clip that would start the time to do so.
    await waitForFrames(page);
    await waitForFrames(page);
    expect(await readClips(page), "Reduced motion: no clip may play or move").toEqual(lab.results.map(() => expect.objectContaining({ paused: true, time: 0 })));

    await control.click();
    await expect(control).toHaveText("Pause clips");
    await expect.poll(async () => (await readClips(page)).every((clip) => !clip.paused && clip.time > 0), { message: "Reduced motion: the control must start the clips", timeout: 20_000 }).toBe(true);
  });

  test("The Lab page holds its clip on the poster", async ({ page, lab }) => {
    await page.goto(`${lab.origin}/lab/`);
    await settle(page);
    await expect(page.locator("button[data-clip-pause]")).toHaveText("Play clips");
    await waitForFrames(page);
    expect(await page.locator("a.lab-card video[data-clip]").evaluate((clip) => ({ paused: clip.paused, time: clip.currentTime }))).toEqual({ paused: true, time: 0 });
  });
});
