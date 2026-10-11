import { expect, test } from "@playwright/test";

import { dispatchPageTransition, emptyResourceCounts, pendingFrames, readResourceCounts, useLifetimeSpy, useManualFrames, useReducedMotion } from "../shared/browser-fixtures.mjs";

for (const failureType of ["canvas", "resize", "intersection", "setup"]) {
  test(`A ${failureType} failure preserves the globe fallback and readable page content`, async ({ page }) => {
    await useManualFrames(page);
    await useLifetimeSpy(page);
    await useReducedMotion(page);
    await page.addInitScript((failureType) => {
      if (failureType === "canvas") HTMLCanvasElement.prototype.getContext = () => null;
      if (failureType === "resize") delete window.ResizeObserver;
      if (failureType === "intersection") delete window.IntersectionObserver;
      if (failureType === "setup") window.__failIntersection = true;
    }, failureType);
    const recordedPageProblems = [];
    page.on("pageerror", (error) => recordedPageProblems.push(error.message));
    await page.goto("/");
    const fallbackGraphic = page.locator("[data-lyra-globe] .lyra-globe__fallback");
    await expect(fallbackGraphic).toBeVisible();
    await expect(fallbackGraphic).toHaveCount(1);
    await expect(fallbackGraphic).toHaveCSS("opacity", "1");
    expect(await fallbackGraphic.locator("path.is-hot").count()).toBeGreaterThanOrEqual(10);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator(".hero__lede")).toBeVisible();
    expect(await pendingFrames(page)).toBe(0);
    expect(await readResourceCounts(page)).toEqual(emptyResourceCounts);
    await dispatchPageTransition(page, "pageshow");
    await expect(fallbackGraphic).toHaveCount(1);
    await page.goto("/about/");
    await expect(page.locator("[data-graphic]")).toBeHidden();
    await expect(page.locator("h1")).toBeVisible();
    expect(await pendingFrames(page)).toBe(0);
    expect(await readResourceCounts(page)).toEqual(emptyResourceCounts);
    expect(recordedPageProblems).toEqual([]);
  });
}

test("A failed globe restore removes resources and keeps one visible fallback", async ({ page }) => {
  await useManualFrames(page);
  await useLifetimeSpy(page);
  await page.goto("/");
  await expect(page.locator("[data-lyra-globe]")).toHaveAttribute("data-ready", "true");
  await expect.poll(() => pendingFrames(page)).toBe(1);
  await dispatchPageTransition(page, "pagehide");
  await page.evaluate(() => { window.__failIntersection = true; });
  await dispatchPageTransition(page, "pageshow");
  await expect(page.locator("[data-lyra-globe] .lyra-globe__fallback")).toHaveCount(1);
  await expect(page.locator("[data-lyra-globe] .lyra-globe__fallback")).toBeVisible();
  expect(await readResourceCounts(page)).toEqual(emptyResourceCounts);
  expect(await pendingFrames(page)).toBe(0);
  await dispatchPageTransition(page, "pageshow");
  await expect(page.locator("[data-lyra-globe] .lyra-globe__fallback")).toHaveCount(1);
  await expect(page.locator("[data-lyra-globe]")).not.toHaveAttribute("data-ready", /.*/);
  await expect(page.locator("h1")).toBeVisible();
});
