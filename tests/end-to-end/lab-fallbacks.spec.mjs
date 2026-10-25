import { expect } from "@playwright/test";
import { labTest as test, settle, stubSceneBodies, VIEWPORTS as viewports } from "../shared/browser-fixtures.mjs";

// The Lab stays readable and navigable when JavaScript is off, and the clips give way to their posters when the browser refuses to play.

test.beforeEach(async ({ page }) => {
  await stubSceneBodies(page);
});

test("The Lab pages stay readable without JavaScript, with posters, links, and no pause control", async ({ browser, lab }) => {
  // Reduced motion turns page transitions off. A running transition makes the page ignore clicks in headless Chromium.
  const browserContext = await browser.newContext({ javaScriptEnabled: false, reducedMotion: "reduce", viewport: viewports.mobile });
  try {
    const page = await browserContext.newPage();
    await page.goto(`${lab.origin}/lab/`);
    await expect(page.locator("button[data-clip-pause]"), "No JavaScript: the pause control must stay hidden").toBeHidden();
    await expect(page.locator("a.lab-card .lab-card__title")).toHaveText(lab.experiment.data.title);
    // Without JavaScript the browser would draw video controls over a clip and catch the click. The clip must hide behind its poster image.
    await expect(page.locator("a.lab-card video[data-clip]"), "No JavaScript: the clip must hide, so no video controls show").toBeHidden();
    await expect(page.locator("a.lab-card img.clip-video__poster"), "No JavaScript: the poster image must show in place of the clip").toBeVisible();
    await page.locator("a.lab-card .lab-card__media").click();
    await expect(page.locator("main h1")).toHaveText(lab.experiment.data.title);
    await expect(page.locator("p.prompt-block__text")).toHaveText(lab.experiment.data.prompt.trim());
    await expect(page.locator("button[data-clip-pause]")).toBeHidden();
    const tiles = page.locator("ul#results a.result-tile");
    await expect(tiles).toHaveCount(lab.results.length);
    expect(await tiles.locator(".result-tile__name").allTextContents()).toEqual(lab.results.map((result) => result.name));
    await expect(page.locator("ul#results video[data-clip]").first(), "No JavaScript: the clip must hide behind its poster").toBeHidden();
    await expect(page.locator("ul#results img.clip-video__poster").first(), "No JavaScript: the result must show its poster").toHaveAttribute("src", `/lab/media/${lab.experiment.id}/posters/${lab.results[0].slug}.webp`);
    expect(await page.locator("ul#results video[data-clip]").first().evaluate((clip) => clip.paused)).toBe(true);
    // A click on the picture itself must follow the link.
    await tiles.nth(1).locator(".result-tile__media").click();
    await expect(page).toHaveURL(`${lab.origin}${lab.experiment.href}${lab.results[1].slug}/`);
    // The arrows work as plain links.
    await expect(page.locator("iframe.scene-stage__frame")).toBeVisible();
    await page.locator("a[data-direction='next']").click();
    await expect(page).toHaveURL(`${lab.origin}${lab.experiment.href}${lab.results[2].slug}/`);
    await expect(page.locator("button[data-scene-full-screen]"), "No JavaScript: the full screen button must stay hidden").toBeHidden();
    await page.locator("a[data-scene-back]").click();
    await expect(page).toHaveURL(lab.origin + lab.experiment.href);
  } finally {
    await browserContext.close();
  }
});

test("The clips pause and the control offers to play when the browser refuses to play", async ({ page, lab }) => {
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = () => Promise.reject(new DOMException("Playback blocked", "NotAllowedError"));
  });
  await page.setViewportSize({ width: 1440, height: 2200 });
  await page.goto(lab.origin + lab.experiment.href);
  await settle(page);
  // The article comes first. A clip refuses to play only once it is on screen.
  await page.locator("ul#results").evaluate((grid) => grid.scrollIntoView({ block: "start", behavior: "instant" }));
  const control = page.locator("button[data-clip-pause]").first();
  await expect(control, "Refused play: the control must offer to play").toHaveText("Play clips");
  expect(await page.locator("ul#results video[data-clip]").evaluateAll((clips) => clips.every((clip) => clip.paused && clip.currentTime === 0)), "Refused play: every clip must stay on its poster").toBe(true);
  await expect(page.locator("ul#results a.result-tile")).toHaveCount(lab.results.length);
});

test("The full screen button shows only where the browser allows full screen", async ({ page, lab }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, "fullscreenEnabled", { configurable: true, get: () => false });
  });
  await page.goto(`${lab.origin}${lab.experiment.href}${lab.results[0].slug}/`);
  await settle(page);
  await expect(page.locator("div[data-scene-stage]")).toHaveClass(/\bscene-stage--live\b/);
  await expect(page.locator("button[data-scene-full-screen]")).toBeHidden();
});

test("The full screen button appears and asks the stage for full screen", async ({ page, lab }) => {
  await page.addInitScript(() => {
    window.__fullScreenTargets = [];
    Element.prototype.requestFullscreen = function () {
      window.__fullScreenTargets.push(this.matches("[data-scene-stage]"));
      return Promise.resolve();
    };
  });
  await page.goto(`${lab.origin}${lab.experiment.href}${lab.results[0].slug}/`);
  await settle(page);
  const button = page.locator("button[data-scene-full-screen]");
  await expect(button).toBeVisible();
  await button.click();
  expect(await page.evaluate(() => window.__fullScreenTargets), "Full screen: the button must ask for the stage").toEqual([true]);
});
