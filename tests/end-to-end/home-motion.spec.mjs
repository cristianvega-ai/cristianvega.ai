import { expect, test } from "@playwright/test";
import { pageProblems, useReducedMotion } from "../shared/browser-fixtures.mjs";

// The mark draws itself, then becomes ready. The entrance lasts about two seconds, so the waits below allow six.
const entranceTimeout = 6000;

// Record the mark class when the load event fires, after the script of the head has run.
const recordMarkClassAtLoad = (page) =>
  page.addInitScript(() => {
    window.addEventListener("load", () => {
      window.__markClassAtLoad = document.querySelector("header.identity svg.mark").getAttribute("class");
    });
  });

test("The home mark draws itself and becomes ready when the entrance ends", async ({ page }) => {
  const recordedPageProblems = pageProblems(page);
  await recordMarkClassAtLoad(page);
  await page.goto("/");
  const mark = page.locator("header.identity svg.mark");
  expect(await page.evaluate(() => window.__markClassAtLoad), "Home mark: it must start in the drawing state").toContain("mark--draw");
  await expect(mark, "Home mark: it must become ready after the entrance").toHaveClass(/\bmark--ready\b/, { timeout: entranceTimeout });
  await expect(mark, "Home mark: the ready state must replace the drawing state").not.toHaveClass(/\bmark--draw\b/);
  await expect.poll(
    () => mark.evaluate((element) => element.querySelector(".mark__halo").getAnimations().map((animation) => animation.animationName)),
    { message: "Home mark: Vega must breathe once the mark is ready", timeout: entranceTimeout },
  ).toEqual(["mark-breathe"]);
  expect(recordedPageProblems).toEqual([]);
});

test.describe("with reduced motion", () => {
  test.beforeEach(async ({ page }) => {
    await useReducedMotion(page);
  });

  test("The home mark is ready at once and plays no animation", async ({ page }) => {
    await recordMarkClassAtLoad(page);
    await page.goto("/");
    const markClass = await page.evaluate(() => window.__markClassAtLoad);
    expect(markClass, "Home mark: reduced motion must skip the drawing state").toContain("mark--ready");
    expect(markClass).not.toContain("mark--draw");
    const mark = page.locator("header.identity svg.mark");
    expect(await mark.evaluate((element) => element.getAnimations({ subtree: true }).length), "Home mark: reduced motion must run no animation on the mark").toBe(0);
    // The figure is complete. A dash pattern would hide part of a line.
    expect(await mark.locator(".mark__line").evaluateAll((lines) => lines.map((line) => getComputedStyle(line).strokeDasharray))).toEqual(Array(6).fill("none"));
  });

  test("The home text appears with no entrance animation", async ({ page }) => {
    await page.goto("/");
    const entranceBlocks = page.locator("main .enter");
    expect(await entranceBlocks.count(), "Home: the page must hold entrance blocks").toBeGreaterThan(0);
    expect(await entranceBlocks.evaluateAll((blocks) => blocks.map((block) => block.getAnimations().length)), "Home: reduced motion must run no entrance")
      .toEqual(Array(await entranceBlocks.count()).fill(0));
    await expect(page.locator("p.bio")).toHaveCSS("opacity", "1");
  });
});
