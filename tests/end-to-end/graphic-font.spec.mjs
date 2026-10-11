import { readFileSync as readFileSynchronously } from "node:fs";
import { expect, test as browserTest } from "@playwright/test";

import { DRAFT_ORIGIN as draftOrigin, drawnLabels, settle, useDeferredPreference, useLabelSpy, useManualFrames, useReducedMotion, VIEWPORTS as viewports, pendingFrames } from "../shared/browser-fixtures.mjs";

const wideFontPath = "/__graphic-wide-font__.woff2";
const monospacedFont = readFileSynchronously(new URL("../../src/assets/fonts/ibm-plex-mono-latin-400.woff2", import.meta.url));

const test = browserTest.extend({
  problems: async ({ page }, use) => {
    const recordedPageProblems = [];
    page.on("pageerror", (error) => recordedPageProblems.push(error.message));
    page.on("console", (message) => {
      const expectedBlockedFontError = message.location().url.includes(".woff2") && message.text().includes("ERR_FAILED");
      if (!expectedBlockedFontError && ["error", "warning"].includes(message.type())) recordedPageProblems.push(message.text());
    });
    await use(recordedPageProblems);
    expect(recordedPageProblems).toEqual([]);
  },
});

async function useFontToken(page, fontFamily, propertyName = "--font-monospace") {
  await page.addInitScript(([propertyName, fontFamily]) => {
    document.addEventListener("readystatechange", () => {
      if (document.readyState === "interactive") document.documentElement.style.setProperty(propertyName, fontFamily, "important");
    });
  }, [propertyName, fontFamily]);
}


async function expectReadableLabels(page) {
  const { labels } = await drawnLabels(page);
  expect(labels.length, "The font check must receive drawn labels").toBeGreaterThan(0);
  for (const label of labels) {
    expect(label.font, `${label.text}: the drawn label must have a canvas font`).toBeTruthy();
    expect(label.localLeft, `${label.text}: the drawn label bounds must stay inside the canvas`).toBeGreaterThanOrEqual(0);
    expect(label.localRight, `${label.text}: the drawn label bounds must stay inside the canvas`).toBeLessThanOrEqual(label.canvasWidth);
    expect(label.localTop, `${label.text}: the drawn label bounds must stay inside the canvas`).toBeGreaterThanOrEqual(0);
    expect(label.localBottom, `${label.text}: the drawn label bounds must stay inside the canvas`).toBeLessThanOrEqual(label.canvasHeight);
  }
  return labels;
}

test("Content and graphic labels remain readable when fonts fail", async ({ page, problems: recordedPageProblems }) => {
  await page.setViewportSize(viewports.mobile);
  await useReducedMotion(page);
  await useLabelSpy(page);
  await page.route("**/*.woff2*", (route) => route.abort());
  await page.goto("/about/");
  await expect(page.locator("[data-graphic]")).toHaveAttribute("data-ready", "true");
  await settle(page);
  await expect(page.locator("main h1")).toBeVisible();
  await expectReadableLabels(page);
  expect(recordedPageProblems).toEqual([]);
});

test("Graphic labels refresh measurements and placement after delayed fonts load and viewport sizes change", async ({ page, problems: recordedPageProblems }) => {
  let releaseFontResponse;
  await useLabelSpy(page);
  await useReducedMotion(page);
  await useFontToken(page, '"Wide Label", monospace');
  await page.route(`**${wideFontPath}`, (route) => new Promise((resolve) => {
    releaseFontResponse = async () => {
      await route.fulfill({ contentType: "font/woff2", body: monospacedFont });
      resolve();
    };
  }));
  await page.addInitScript((fontPath) => {
    const fontFace = new FontFace("Wide Label", `url(${fontPath})`, { sizeAdjust: "160%" });
    document.fonts.add(fontFace);
    window.__wideFont = fontFace;
    window.__wideFontReady = fontFace.load();
  }, wideFontPath);
  await page.goto("/about/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-graphic]")).toHaveAttribute("data-ready", "true");
  await expect.poll(() => typeof releaseFontResponse).toBe("function");
  expect(await page.evaluate(() => window.__wideFont.status)).toBe("loading");
  const fallbackLabel = (await drawnLabels(page)).labels.find((label) => label.text === "VEGA · α LYR");
  const fallbackWidth = fallbackLabel.localRight - fallbackLabel.localLeft;
  const measurementCount = await page.evaluate(() => window.__labelMeasureCount);
  await releaseFontResponse();
  await page.evaluate(() => window.__wideFontReady);
  await settle(page);
  await expect.poll(async () => {
    const label = (await drawnLabels(page)).labels.find((drawnLabel) => drawnLabel.text === "VEGA · α LYR");
    return label.localRight - label.localLeft;
  }).toBeGreaterThan(fallbackWidth * 1.4);
  expect(await page.evaluate(() => window.__labelMeasureCount)).toBeGreaterThan(measurementCount);
  for (const viewport of [viewports.desktop, viewports.mobile]) {
    await page.evaluate(() => window.__labels.clear());
    await page.setViewportSize(viewport);
    await expect.poll(() => page.evaluate(() => window.__labels.size)).toBeGreaterThan(0);
    await settle(page);
    await expectReadableLabels(page);
  }
  expect(recordedPageProblems).toEqual([]);
});

test("Graphic font refresh applies a pending motion preference before drawing", async ({ page, problems: recordedPageProblems }) => {
  await useLabelSpy(page);
  await useManualFrames(page);
  await useDeferredPreference(page);
  await page.goto("/about/");
  await expect(page.locator("[data-graphic]")).toHaveAttribute("data-ready", "true");
  await settle(page);
  await expect.poll(() => pendingFrames(page)).toBe(1);
  await useReducedMotion(page);
  await expect.poll(() => page.evaluate(() => window.__preferenceJobs.length)).toBe(1);
  await page.evaluate(() => {
    document.documentElement.style.setProperty("--font-monospace", '"IBM Plex Sans", sans-serif');
    document.fonts.dispatchEvent(new Event("loadingdone"));
  });
  // The controller must apply the pending motion preference before the font redraw.
  await expect(page.locator("[data-graphic]")).toHaveAttribute("data-motion-state", "still");
  expect(await pendingFrames(page)).toBe(0);
  await page.evaluate(() => window.__preferenceJobs.shift()());
  await expect(page.locator("[data-graphic]")).toHaveAttribute("data-motion-state", "still");
  expect(await pendingFrames(page)).toBe(0);
  const labels = await expectReadableLabels(page);
  expect(labels[0].font).toContain("IBM Plex Sans");
  expect(recordedPageProblems).toEqual([]);
});

test("Graphic font callbacks stop after teardown and labels rebuild after page restoration", async ({ page, problems: recordedPageProblems }) => {
  await useLabelSpy(page);
  await useReducedMotion(page);
  await page.addInitScript(() => {
    const nativeReadyGetter = Object.getOwnPropertyDescriptor(FontFaceSet.prototype, "ready").get;
    window.__nativeFontReady = () => nativeReadyGetter.call(document.fonts);
    const fontReadyPromise = new Promise((resolve) => { window.__releaseFontReady = resolve; });
    Object.defineProperty(document.fonts, "ready", { configurable: true, get: () => fontReadyPromise });
  });
  await page.goto("/about/");
  await expect(page.locator("[data-graphic]")).toHaveAttribute("data-ready", "true");
  await page.evaluate(() => window.__nativeFontReady());
  const measurementCount = await page.evaluate(() => window.__labelMeasureCount);
  await page.evaluate(() => {
    dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    window.__releaseFontReady();
    document.fonts.dispatchEvent(new Event("loadingdone"));
    document.fonts.dispatchEvent(new Event("loadingerror"));
  });
  expect(await page.evaluate(() => window.__labelMeasureCount)).toBe(measurementCount);
  await expect(page.locator("[data-graphic]")).not.toHaveAttribute("data-ready", /.*/);
  await page.evaluate(() => {
    document.documentElement.style.setProperty("--font-monospace", '"IBM Plex Sans", sans-serif');
    dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });
  await expect(page.locator("[data-graphic]")).toHaveAttribute("data-ready", "true");
  await settle(page);
  const labels = await expectReadableLabels(page);
  expect(labels[0].font).toContain("IBM Plex Sans");
  expect(await page.evaluate(() => window.__labelMeasureCount)).toBeGreaterThan(measurementCount);
  expect(recordedPageProblems).toEqual([]);
});
