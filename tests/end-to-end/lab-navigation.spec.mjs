import { expect } from "@playwright/test";
import { DRAFT_ORIGIN as draftOrigin, currentContent, currentPublished, expectReadablePage, labTest as test, pageProblems, readingStar, settle, stubSceneBodies, useReducedMotion } from "../shared/browser-fixtures.mjs";

// Reduced motion turns page transitions off. A running transition makes the page ignore clicks in headless Chromium.
test.beforeEach(async ({ page }) => {
  await useReducedMotion(page);
  await stubSceneBodies(page);
});

const historyIndex = (page) => page.evaluate(() => navigation.currentEntry.index);
const historyLength = (page) => page.evaluate(() => navigation.entries().length);

/** The scene page holds the stage and the bar. Wait until both exist before the test acts. */
async function expectScenePage(page, lab, result, position) {
  await expect(page).toHaveURL(`${lab.origin}${lab.experiment.href}${result.slug}/`);
  await expect(page.locator("html")).toHaveAttribute("data-page", "scene");
  await expect(page.locator("html")).toHaveAttribute("data-stage-key", result.slug);
  await expect(page.locator("h1.scene-bar__title")).toHaveText(new RegExp(`^\\s*${result.name}`));
  await expect(page.locator(".scene-bar__position")).toHaveText(position);
  await expect(page.locator("iframe.scene-stage__frame")).toHaveAttribute("src", `/lab/scenes/${lab.experiment.id}/${result.slug}/`);
}

test("The Lab opens an experiment and a scene, and the way back returns to each page", async ({ page, lab }) => {
  const recordedPageProblems = pageProblems(page);
  await page.goto(`${lab.origin}/lab/`);
  await settle(page);
  await expectReadablePage(page);
  await expect(page.locator("html")).toHaveAttribute("data-page", "lab");
  await expect(page.locator("main h1")).toHaveText("Lab");
  await expect(readingStar(page).label).toHaveText("Home");
  const card = page.locator("ul.lab-index > li > a.lab-card");
  await expect(card, "Lab: one card for each published experiment").toHaveCount(1);
  await expect(card).toHaveAttribute("href", lab.experiment.href);
  await expect(card).toHaveAttribute("data-morph-key", `lab/${lab.experiment.id}`);
  await expect(card.locator(".lab-card__title")).toHaveText(lab.experiment.data.title);
  await expect(card.locator(".lab-card__meta")).toHaveText(`${lab.results.length} models`);
  await expect(card.locator(".lab-card__draft"), "Lab: a published experiment carries no draft mark").toHaveCount(0);
  await expect(page.locator("li.lab-index__group")).toHaveCount(1);

  await card.click();
  await expect(page).toHaveURL(lab.origin + lab.experiment.href);
  await settle(page);
  await expectReadablePage(page);
  await expect(page.locator("html")).toHaveAttribute("data-page", "experiment");
  await expect(page.locator("main h1")).toHaveText(lab.experiment.data.title);
  await expect(readingStar(page).label).toHaveText("Lab");
  await expect(page.locator("p.prompt-block__text")).toHaveText(lab.experiment.data.prompt.trim());
  const tiles = page.locator("ul#results a.result-tile");
  await expect(tiles).toHaveCount(lab.results.length);
  expect(await tiles.evaluateAll((links) => links.map((link) => link.getAttribute("href"))), "Experiment: tiles must follow the result order")
    .toEqual(lab.results.map((result) => `${lab.experiment.href}${result.slug}/`));
  expect(await tiles.locator(".result-tile__name").allTextContents()).toEqual(lab.results.map((result) => result.name));
  expect(await tiles.evaluateAll((links) => links.map((link) => link.querySelector(".result-tile__effort")?.textContent ?? "")), "Experiment: a tile shows an effort only when the result has one")
    .toEqual(lab.results.map((result) => result.effort ?? ""));
  await expect(page.locator("p.results__note")).toContainText(lab.experiment.data.note);

  const resultIndex = 2;
  await tiles.nth(resultIndex).click();
  await expectScenePage(page, lab, lab.results[resultIndex], `${resultIndex + 1} of ${lab.results.length}`);
  await settle(page);
  await expect(page.locator("a[data-scene-back]")).toHaveAttribute("href", lab.experiment.href);
  await expect(page.locator("a[data-scene-back] .scene-bar__back-label")).toHaveText(lab.experiment.data.label);
  await expect(page.locator("div[data-scene-stage] img.scene-stage__poster")).toHaveAttribute("src", `/lab/media/${lab.experiment.id}/posters/${lab.results[resultIndex].slug}.webp`);
  // The frame loads, then the stage and the bar turn live.
  await expect(page.locator("div[data-scene-stage]")).toHaveClass(/\bscene-stage--live\b/);
  await expect(page.locator("nav.scene-bar")).toHaveClass(/\bscene-bar--live\b/);

  const indexBefore = await historyIndex(page);
  await page.locator("a[data-scene-back]").click();
  await expect(page).toHaveURL(lab.origin + lab.experiment.href);
  expect(await historyIndex(page), "Scene: the back link must go back in history when the experiment is the previous page").toBe(indexBefore - 1);
  await readingStar(page).link.click();
  await expect(page).toHaveURL(`${lab.origin}/lab/`);
  await expect(page.locator("main h1")).toHaveText("Lab");
  expect(recordedPageProblems).toEqual([]);
});

test("The scene arrows replace the history entry and wrap around the group", async ({ page, lab }) => {
  const recordedPageProblems = pageProblems(page);
  const lastIndex = lab.results.length - 1;
  await page.goto(lab.origin + lab.experiment.href);
  await settle(page);
  await page.locator("ul#results a.result-tile").first().click();
  await expectScenePage(page, lab, lab.results[0], `1 of ${lab.results.length}`);
  await settle(page);
  const indexBefore = await historyIndex(page);
  const lengthBefore = await historyLength(page);

  await expect(page.locator("a[data-direction='previous']")).toHaveAttribute("aria-label", `Previous: ${lab.results[lastIndex].name}`);
  await page.locator("a[data-direction='previous']").click();
  await expectScenePage(page, lab, lab.results[lastIndex], `${lab.results.length} of ${lab.results.length}`);
  await settle(page);
  await page.locator("a[data-direction='next']").click();
  await expectScenePage(page, lab, lab.results[0], `1 of ${lab.results.length}`);
  await settle(page);
  await page.locator("a[data-direction='next']").click();
  await expectScenePage(page, lab, lab.results[1], `2 of ${lab.results.length}`);
  expect(await historyIndex(page), "Scene: the arrows must replace the entry, so the index stays").toBe(indexBefore);
  expect(await historyLength(page), "Scene: the arrows must add no history entry").toBe(lengthBefore);

  // One step back leaves the group, because the arrows added no entry.
  await page.goBack();
  await expect(page).toHaveURL(lab.origin + lab.experiment.href);
  expect(recordedPageProblems).toEqual([]);
});

test("The arrow keys step through the scenes while the page has focus", async ({ page, lab }) => {
  await page.goto(`${lab.origin}${lab.experiment.href}${lab.results[0].slug}/`);
  await settle(page);
  await expect(page.locator("div[data-scene-stage]")).toHaveClass(/\bscene-stage--live\b/);
  await page.locator("main").evaluate((main) => main.focus());
  await page.keyboard.press("ArrowRight");
  await expectScenePage(page, lab, lab.results[1], `2 of ${lab.results.length}`);
  await page.locator("main").evaluate((main) => main.focus());
  await page.keyboard.press("ArrowLeft");
  await expectScenePage(page, lab, lab.results[0], `1 of ${lab.results.length}`);
  await page.locator("main").evaluate((main) => main.focus());
  await page.keyboard.press("ArrowLeft");
  await expectScenePage(page, lab, lab.results.at(-1), `${lab.results.length} of ${lab.results.length}`);
});

test("Escape returns from a scene to the experiment through history", async ({ page, lab }) => {
  await page.goto(lab.origin + lab.experiment.href);
  await settle(page);
  await page.locator("ul#results a.result-tile").nth(4).click();
  await expectScenePage(page, lab, lab.results[4], `5 of ${lab.results.length}`);
  await settle(page);
  const indexBefore = await historyIndex(page);
  await page.locator("main").evaluate((main) => main.focus());
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(lab.origin + lab.experiment.href);
  expect(await historyIndex(page), "Scene: Escape must go back in history when the experiment is the previous page").toBe(indexBefore - 1);
});

test("A scene opened by address returns to the experiment with the back link and with Escape", async ({ page, lab }) => {
  const scenePath = `${lab.experiment.href}${lab.results[3].slug}/`;
  await page.goto(lab.origin + scenePath);
  await settle(page);
  const indexBefore = await historyIndex(page);
  await page.locator("a[data-scene-back]").click();
  await expect(page).toHaveURL(lab.origin + lab.experiment.href);
  expect(await historyIndex(page), "Scene: with no previous page the back link must add a history entry").toBe(indexBefore + 1);

  await page.goto(lab.origin + scenePath);
  await settle(page);
  await page.locator("main").evaluate((main) => main.focus());
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(lab.origin + lab.experiment.href);
});

test("The Lab section of the homepage opens the experiment and the Lab page", async ({ page, lab }) => {
  await page.goto(lab.origin + "/");
  await settle(page);
  const section = page.locator("section.home-section[aria-labelledby='lab-label']");
  await expect(section.getByRole("heading", { level: 2 })).toHaveText("Lab");
  const rows = section.locator("a.entry-row");
  await expect(rows).toHaveCount(1);
  await expect(rows).toHaveAttribute("href", lab.experiment.href);
  await expect(rows.locator(".entry-row__title")).toHaveText(lab.experiment.data.title);
  await expect(rows.locator(".entry-row__meta")).toHaveText(`${lab.results.length} models`);
  await section.getByRole("link", { name: "All experiments", exact: true }).click();
  await expect(page).toHaveURL(`${lab.origin}/lab/`);
  await page.goBack();
  await rows.click();
  await expect(page).toHaveURL(lab.origin + lab.experiment.href);
  await expect(page.locator("main h1")).toHaveText(lab.experiment.data.title);
  await expect(readingStar(page).label).toHaveText("Home");
});

// The production runtime serves the real build. The Lab is hidden there while its experiments are drafts.
test("Production shows the Lab only for published experiments", async ({ request }) => {
  const publishedExperiments = currentPublished.lab;
  expect((await request.get("/lab/")).status(), "/lab/ must follow publication").toBe(publishedExperiments.length ? 200 : 404);
  for (const experiment of currentContent.lab) {
    const isPublished = !experiment.data.draft;
    expect((await request.get(experiment.href)).status(), experiment.href).toBe(isPublished ? 200 : 404);
    for (const result of experiment.data.results) {
      expect((await request.get(`${experiment.href}${result.slug}/`)).status(), `${experiment.href}${result.slug}/`).toBe(isPublished ? 200 : 404);
      expect((await request.get(`/lab/scenes/${experiment.id}/${result.slug}/`)).status(), `the ${result.slug} scene`).toBe(isPublished ? 200 : 404);
      expect((await request.get(`/lab/media/${experiment.id}/clips/${result.slug}.av1.mp4`)).status(), `the ${result.slug} clip`).toBe(isPublished ? 200 : 404);
    }
  }
});

test("The draft server shows the Lab drafts with a draft mark and no indexing", async ({ page, request }) => {
  const recordedPageProblems = pageProblems(page);
  const draftExperiments = currentContent.lab.filter((experiment) => experiment.data.draft);
  expect(draftExperiments.length, "The Lab fixtures must hold a draft for this check").toBeGreaterThan(0);
  await page.goto(`${draftOrigin}/lab/`);
  await settle(page);
  await expect(page.locator("meta[name='robots']")).toHaveAttribute("content", "noindex, follow");
  for (const experiment of draftExperiments) {
    await expect(page.locator(`a.lab-card[href='${experiment.href}'] .lab-card__draft`)).toHaveText("Draft");
    expect((await request.get(draftOrigin + experiment.href)).status()).toBe(200);
  }
  const experiment = draftExperiments[0];
  await page.locator(`a.lab-card[href='${experiment.href}']`).click();
  await expect(page.locator("p.detail__draft")).toBeVisible();
  await expect(page.locator("meta[name='robots']")).toHaveAttribute("content", "noindex, follow");
  await page.locator("ul#results a.result-tile").first().click();
  await expect(page.locator("html")).toHaveAttribute("data-page", "scene");
  await expect(page.locator("meta[name='robots']")).toHaveAttribute("content", "noindex, follow");
  expect(recordedPageProblems).toEqual([]);
});
