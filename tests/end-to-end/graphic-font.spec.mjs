import { readFileSync as readFileSynchronously } from "node:fs";
import { expect, test as baseTest } from "@playwright/test";

import { DRAFT_ORIGIN, drawnLabels, settle, useLabelSpy, useManualFrames, useReducedMotion, VIEWPORTS, pendingFrames } from "../support/browser-fixtures.mjs";

const wideFontPath = "/__graphic-wide-font__.woff2";
const monospacedFont = readFileSynchronously(new URL("../../src/assets/fonts/ibm-plex-mono-latin-400.woff2", import.meta.url));

const test = baseTest.extend({
  problems: async ({ page }, use) => {
    const problems = [];
    page.on("pageerror", (error) => problems.push(error.message));
    page.on("console", (message) => {
      const blockedFont = message.location().url.includes(".woff2") && message.text().includes("ERR_FAILED");
      if (!blockedFont && ["error", "warning"].includes(message.type())) problems.push(message.text());
    });
    await use(problems);
    expect(problems).toEqual([]);
  },
});

async function useFontToken(page, family, name = "--font-monospace") {
  await page.addInitScript(([property, token]) => {
    document.addEventListener("readystatechange", () => {
      if (document.readyState === "interactive") document.documentElement.style.setProperty(property, token, "important");
    });
  }, [name, family]);
}


async function assertLabels(page) {
  const { labels } = await drawnLabels(page);
  expect(labels.length, "the font check requires drawn labels").toBeGreaterThan(0);
  for (const label of labels) {
    expect(label.font, `${label.text}: the label has a canvas font`).toBeTruthy();
    expect(label.localLeft, `${label.text}: the label stays inside the canvas`).toBeGreaterThanOrEqual(0);
    expect(label.localRight, `${label.text}: the label stays inside the canvas`).toBeLessThanOrEqual(label.canvasWidth);
    expect(label.localTop, `${label.text}: the label stays inside the canvas`).toBeGreaterThanOrEqual(0);
    expect(label.localBottom, `${label.text}: the label stays inside the canvas`).toBeLessThanOrEqual(label.canvasHeight);
  }
  return labels;
}

test("missing fonts keep content and graphic labels readable", async ({ page, problems }) => {
  await page.setViewportSize(VIEWPORTS.mobile);
  await useReducedMotion(page);
  await useLabelSpy(page);
  await page.route("**/*.woff2*", (route) => route.abort());
  await page.goto("/about/");
  await expect(page.locator("[data-graphic]")).toHaveAttribute("data-ready", "true");
  await settle(page);
  await expect(page.locator("main h1")).toBeVisible();
  await assertLabels(page);
  expect(problems).toEqual([]);
});

test("refreshes delayed wide font measurements and resized placement", async ({ page, problems }) => {
  let release;
  await useLabelSpy(page);
  await useReducedMotion(page);
  await useFontToken(page, '"Wide Label", monospace');
  await page.route(`**${wideFontPath}`, (route) => new Promise((resolve) => {
    release = async () => {
      await route.fulfill({ contentType: "font/woff2", body: monospacedFont });
      resolve();
    };
  }));
  await page.addInitScript((fontPath) => {
    const face = new FontFace("Wide Label", `url(${fontPath})`, { sizeAdjust: "160%" });
    document.fonts.add(face);
    window.__wideFont = face;
    window.__wideFontReady = face.load();
  }, wideFontPath);
  await page.goto("/about/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-graphic]")).toHaveAttribute("data-ready", "true");
  await expect.poll(() => typeof release).toBe("function");
  expect(await page.evaluate(() => window.__wideFont.status)).toBe("loading");
  const before = (await drawnLabels(page)).labels.find((label) => label.text === "VEGA · α LYR");
  const fallbackWidth = before.localRight - before.localLeft;
  const measures = await page.evaluate(() => window.__labelMeasureCount);
  await release();
  await page.evaluate(() => window.__wideFontReady);
  await settle(page);
  await expect.poll(async () => {
    const label = (await drawnLabels(page)).labels.find((item) => item.text === "VEGA · α LYR");
    return label.localRight - label.localLeft;
  }).toBeGreaterThan(fallbackWidth * 1.4);
  expect(await page.evaluate(() => window.__labelMeasureCount)).toBeGreaterThan(measures);
  for (const viewport of [VIEWPORTS.desktop, VIEWPORTS.mobile]) {
    await page.evaluate(() => window.__labels.clear());
    await page.setViewportSize(viewport);
    await expect.poll(() => page.evaluate(() => window.__labels.size)).toBeGreaterThan(0);
    await settle(page);
    await assertLabels(page);
  }
  expect(problems).toEqual([]);
});

test("applies a pending motion preference when a font refresh comes first", async ({ page, problems }) => {
  await useLabelSpy(page);
  await useManualFrames(page);
  await page.addInitScript(() => {
    const originalAddEventListener = MediaQueryList.prototype.addEventListener;
    const originalRemoveEventListener = MediaQueryList.prototype.removeEventListener;
    const wrappers = new WeakMap();
    window.__preferenceJobs = [];
    MediaQueryList.prototype.addEventListener = function (type, listener, options) {
      if (type !== "change" || !this.media.includes("prefers-reduced-motion")) return originalAddEventListener.call(this, type, listener, options);
      const wrapped = (event) => window.__preferenceJobs.push(() => listener.call(this, event));
      wrappers.set(listener, wrapped);
      return originalAddEventListener.call(this, type, wrapped, options);
    };
    MediaQueryList.prototype.removeEventListener = function (type, listener, options) {
      return originalRemoveEventListener.call(this, type, wrappers.get(listener) ?? listener, options);
    };
  });
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
  // The controller applies the new preference before the font redraw, whatever the event order.
  await expect(page.locator("[data-graphic]")).toHaveAttribute("data-motion-state", "still");
  expect(await pendingFrames(page)).toBe(0);
  await page.evaluate(() => window.__preferenceJobs.shift()());
  await expect(page.locator("[data-graphic]")).toHaveAttribute("data-motion-state", "still");
  expect(await pendingFrames(page)).toBe(0);
  const labels = await assertLabels(page);
  expect(labels[0].font).toContain("IBM Plex Sans");
  expect(problems).toEqual([]);
});

test("ignores font callbacks after teardown and rebuilds after restore", async ({ page, problems }) => {
  await useLabelSpy(page);
  await useReducedMotion(page);
  await page.addInitScript(() => {
    const ready = Object.getOwnPropertyDescriptor(FontFaceSet.prototype, "ready").get;
    window.__nativeFontReady = () => ready.call(document.fonts);
    const pending = new Promise((resolve) => { window.__releaseFontReady = resolve; });
    Object.defineProperty(document.fonts, "ready", { configurable: true, get: () => pending });
  });
  await page.goto("/about/");
  await expect(page.locator("[data-graphic]")).toHaveAttribute("data-ready", "true");
  await page.evaluate(() => window.__nativeFontReady());
  const measures = await page.evaluate(() => window.__labelMeasureCount);
  await page.evaluate(() => {
    dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    window.__releaseFontReady();
    document.fonts.dispatchEvent(new Event("loadingdone"));
    document.fonts.dispatchEvent(new Event("loadingerror"));
  });
  expect(await page.evaluate(() => window.__labelMeasureCount)).toBe(measures);
  await expect(page.locator("[data-graphic]")).not.toHaveAttribute("data-ready", /.*/);
  await page.evaluate(() => {
    document.documentElement.style.setProperty("--font-monospace", '"IBM Plex Sans", sans-serif');
    dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });
  await expect(page.locator("[data-graphic]")).toHaveAttribute("data-ready", "true");
  await settle(page);
  const labels = await assertLabels(page);
  expect(labels[0].font).toContain("IBM Plex Sans");
  expect(await page.evaluate(() => window.__labelMeasureCount)).toBeGreaterThan(measures);
  expect(problems).toEqual([]);
});
