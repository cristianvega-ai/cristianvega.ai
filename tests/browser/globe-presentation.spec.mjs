import { expect, test } from "@playwright/test";
import { paintedPixels, pendingFrames, playFrames, settle, useManualFrames, useReducedMotion, VIEWPORTS } from "./fixtures.mjs";

const globe = "[data-lyra-globe]";
const labels = `${globe} .lyra-globe__label`;
const opacity = (page) => page.locator(labels).evaluateAll((nodes) => nodes.map((node) => Number(getComputedStyle(node).opacity)));
const transition = (page, type) => page.evaluate((name) => {
  window.dispatchEvent(new PageTransitionEvent(name, { persisted: true }));
}, type);

test.use({ viewport: VIEWPORTS.desktop });

async function finishLabels(page) {
  await expect(page.locator(globe)).toHaveAttribute("data-motion-state", "still");
  const visible = await opacity(page);
  expect(visible.length, "the globe supplies visible labels").toBeGreaterThan(0);
  expect(visible.every((value) => value > 0), "the completed labels must be visible").toBe(true);
  await expect.poll(() => page.locator(labels).evaluateAll((nodes) => nodes.flatMap((node) => node.getAnimations()).length)).toBe(0);
  await settle(page);
}

test("globe labels pause with their canvas in a hidden tab", async ({ page }) => {
  await useManualFrames(page);
  await page.goto("/");
  await expect(page.locator(globe)).toHaveAttribute("data-ready", "true");
  await playFrames(page, 800);
  await expect.poll(async () => (await opacity(page))[1]).toBeGreaterThan(0);
  const first = await opacity(page);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(await pendingFrames(page), "the hidden globe must stop its clock").toBe(0);
  await playFrames(page, 3000);
  expect(await opacity(page), "the labels must keep their paused progress").toEqual(first);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(await pendingFrames(page)).toBe(1);
  await playFrames(page, 3000);
  await finishLabels(page);
  expect(await pendingFrames(page)).toBe(0);
});

test("a restored globe replays its entrance and completes its labels", async ({ page }) => {
  await useManualFrames(page);
  await page.goto("/");
  await expect(page.locator(globe)).toHaveAttribute("data-ready", "true");
  await playFrames(page, 3000);
  await finishLabels(page);
  await transition(page, "pagehide");
  expect(await pendingFrames(page), "the hidden page must cancel its frames").toBe(0);
  await expect(page.locator(globe)).not.toHaveAttribute("data-ready", /.*/);
  await transition(page, "pageshow");
  await expect(page.locator(globe)).toHaveAttribute("data-motion-state", "playing");
  expect(await pendingFrames(page)).toBe(1);
  await playFrames(page, 3000);
  await finishLabels(page);
});

test("shows complete labels for reduced motion and live preference changes", async ({ page }) => {
  await useManualFrames(page);
  await useReducedMotion(page);
  await page.goto("/");
  await finishLabels(page);
  expect(await pendingFrames(page)).toBe(0);
  await useReducedMotion(page, "no-preference");
  await finishLabels(page);
  await transition(page, "pagehide");
  await transition(page, "pageshow");
  await expect(page.locator(globe)).toHaveAttribute("data-ready", "true");
  await expect.poll(() => pendingFrames(page)).toBe(1);
  expect(await opacity(page)).toEqual([0, 0]);
  await playFrames(page, 816);
  await useReducedMotion(page);
  await finishLabels(page);
  expect(await pendingFrames(page)).toBe(0);
});

// A failed projection stylesheet must leave useful geometry in both layouts.
for (const viewport of [VIEWPORTS.desktop, VIEWPORTS.mobile]) {
  test(`home keeps a readable globe after stylesheet failure at ${viewport.width}px`, async ({ page }) => {
    const problems = [];
    page.on("pageerror", (error) => problems.push(error.message));
    page.on("console", (message) => {
      const blockedStylesheet = message.location().url.includes("/globe-projection/") && message.text().includes("ERR_FAILED");
      if (message.type() === "error" && !blockedStylesheet) problems.push(message.text());
    });
    await page.setViewportSize(viewport);
    await useReducedMotion(page);
    await page.route("**/globe-projection/**", (route) => route.abort());
    await page.goto("/");
    await expect(page.locator(globe)).toHaveAttribute("data-ready", "true");
    await finishLabels(page);
    await expect(page.locator("h1")).toBeVisible();
    const box = await page.locator(globe).boundingBox();
    expect(box.width, "the globe keeps a useful width without its stylesheet").toBeGreaterThan(100);
    expect(box.height, "the globe keeps a useful height without its stylesheet").toBeGreaterThan(100);
    expect(await paintedPixels(page, globe, 8), "the stylesheet fallback must leave foreground paint").toBeGreaterThan(100);
    expect(problems).toEqual([]);
  });
}
