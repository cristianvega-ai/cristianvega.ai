import { readFileSync } from "node:fs";
import { expect, test as base } from "@playwright/test";

import { drawnLabels, settle, useLabelSpy, useManualFrames, useReducedMotion, VIEWPORTS, pendingFrames } from "./fixtures.mjs";

const dev = process.env.E2E_DRAFT_ORIGIN ?? "http://127.0.0.1:4324";
const missingPath = "/__graphic-font-missing__/";
const pages = ["/about/", `${dev}/writing/`, `${dev}/products/`, missingPath];
const wideFontPath = "/__graphic-wide-font__.woff2";
const monoFont = readFileSync(new URL("../../src/assets/fonts/ibm-plex-mono-latin-400.woff2", import.meta.url));

const test = base.extend({
  problems: async ({ page }, use) => {
    const problems = [];
    page.on("pageerror", (error) => problems.push(error.message));
    page.on("console", (message) => {
      const expected404 = message.location().url.endsWith(missingPath) && message.text().includes("404");
      if (!expected404 && ["error", "warning"].includes(message.type())) problems.push(message.text());
    });
    await use(problems);
    expect(problems).toEqual([]);
  },
});

async function useFontToken(page, family) {
  await page.addInitScript((token) => {
    document.addEventListener("readystatechange", () => {
      if (document.readyState === "interactive") document.documentElement.style.setProperty("--font-mono", token, "important");
    });
  }, family);
}

async function assertLabels(page) {
  const { labels, ink, viewport } = await drawnLabels(page);
  const entries = await page.locator("[data-writing-label]").allTextContents();
  const names = labels.map((label) => label.text);
  expect(names).toEqual(expect.arrayContaining(entries.length ? entries.map((text) => text.trim()) : ["VEGA · α LYR"]));
  const expectedFont = await page.locator("[data-graphic]").evaluate((graphic) => {
    const context = document.createElement("canvas").getContext("2d");
    const family = getComputedStyle(graphic).getPropertyValue("--font-mono").trim();
    context.font = `400 10px ${family || "ui-monospace, monospace"}`;
    return context.font;
  });
  for (const label of labels) {
    expect(label.font).toBe(expectedFont);
    expect(label.left).toBeGreaterThanOrEqual(32);
    expect(label.right).toBeLessThanOrEqual(viewport - 32);
    expect(label.localLeft).toBeGreaterThanOrEqual(24);
    expect(label.localRight).toBeLessThanOrEqual(label.canvasWidth - 24);
    expect(label.localTop).toBeGreaterThanOrEqual(16);
    expect(label.localBottom).toBeLessThanOrEqual(label.canvasHeight - 16);
    expect(label.halo).toEqual({ lineWidth: 3.5, lineJoin: "round", style: ink });
  }
  return labels;
}

for (const viewport of Object.values(VIEWPORTS)) {
  for (const { name, family } of [
    { name: "the CSS font token" },
    { name: "a proportional font", family: '"IBM Plex Sans", sans-serif' },
    { name: "a missing font fallback", family: '"Unavailable Graphic Font", monospace' },
  ]) {
    test(`uses ${name} across page graphics at ${viewport.width}px`, async ({ page, problems }) => {
      await page.setViewportSize(viewport);
      await useLabelSpy(page);
      await useReducedMotion(page);
      if (family) await useFontToken(page, family);
      for (const target of pages) {
        await page.goto(target);
        await expect(page.locator("[data-graphic]")).toHaveAttribute("data-ready", "true");
        await settle(page);
        await expect(page.locator("main h1")).toBeVisible();
        await assertLabels(page);
        expect(await page.evaluate(() => window.__labelMeasureCount)).toBeGreaterThan(0);
      }
      expect(problems).toEqual([]);
    });
  }
}

test("refreshes delayed wide font measurements and resized placement", async ({ page, problems }) => {
  let release;
  await useLabelSpy(page);
  await useReducedMotion(page);
  await useFontToken(page, '"Wide Label", monospace');
  await page.route(`**${wideFontPath}`, (route) => new Promise((resolve) => {
    release = async () => {
      await route.fulfill({ contentType: "font/woff2", body: monoFont });
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
  for (const viewport of Object.values(VIEWPORTS)) {
    await page.evaluate(() => window.__labels.clear());
    await page.setViewportSize(viewport);
    await expect.poll(() => page.evaluate(() => window.__labels.size)).toBeGreaterThan(0);
    await settle(page);
    await assertLabels(page);
  }
  expect(problems).toEqual([]);
});

test("keeps label measurement outside animation frames", async ({ page, problems }) => {
  await useLabelSpy(page);
  await useManualFrames(page);
  for (const target of ["/about/", `${dev}/writing/`]) {
    await page.goto(target);
    await expect(page.locator("[data-graphic]")).toHaveAttribute("data-ready", "true");
    await settle(page);
    await expect.poll(() => pendingFrames(page)).toBe(1);
    const measures = await page.evaluate(() => window.__labelMeasureCount);
    await page.evaluate(() => {
      for (let time = 0; time <= 3000; time += 16) window.__step(time);
    });
    expect(await page.evaluate(() => window.__labelMeasureCount)).toBe(measures);
    await expect(page.locator("[data-graphic]")).toHaveAttribute("data-motion-state", "still");
    expect(await pendingFrames(page)).toBe(0);
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--font-mono", '"IBM Plex Sans", sans-serif');
      document.fonts.dispatchEvent(new Event("loadingdone"));
    });
    expect(await page.evaluate(() => window.__labelMeasureCount)).toBeGreaterThan(measures);
    expect(await pendingFrames(page)).toBe(0);
    await assertLabels(page);
  }
  expect(problems).toEqual([]);
});

test("defers font redraws until the controller applies a motion preference", async ({ page, problems }) => {
  await useLabelSpy(page);
  await useManualFrames(page);
  await page.addInitScript(() => {
    const add = MediaQueryList.prototype.addEventListener;
    const remove = MediaQueryList.prototype.removeEventListener;
    const wrappers = new WeakMap();
    window.__preferenceJobs = [];
    MediaQueryList.prototype.addEventListener = function (type, listener, options) {
      if (type !== "change" || !this.media.includes("prefers-reduced-motion")) return add.call(this, type, listener, options);
      const wrapped = (event) => window.__preferenceJobs.push(() => listener.call(this, event));
      wrappers.set(listener, wrapped);
      return add.call(this, type, wrapped, options);
    };
    MediaQueryList.prototype.removeEventListener = function (type, listener, options) {
      return remove.call(this, type, wrappers.get(listener) ?? listener, options);
    };
  });
  await page.goto("/about/");
  await expect(page.locator("[data-graphic]")).toHaveAttribute("data-ready", "true");
  await settle(page);
  await expect.poll(() => pendingFrames(page)).toBe(1);
  await useReducedMotion(page);
  await expect.poll(() => page.evaluate(() => window.__preferenceJobs.length)).toBe(1);
  await page.evaluate(() => {
    document.documentElement.style.setProperty("--font-mono", '"IBM Plex Sans", sans-serif');
    document.fonts.dispatchEvent(new Event("loadingdone"));
  });
  await expect(page.locator("[data-graphic]")).toHaveAttribute("data-motion-state", "playing");
  expect(await pendingFrames(page)).toBe(1);
  await page.evaluate(() => window.__preferenceJobs.shift()());
  await expect(page.locator("[data-graphic]")).toHaveAttribute("data-motion-state", "still");
  expect(await pendingFrames(page)).toBe(0);
  const labels = await assertLabels(page);
  expect(labels[0].font).toContain("IBM Plex Sans");
  expect(problems).toEqual([]);
});

test("wakes a resting scene when refreshed labels need more motion", async ({ page, problems }) => {
  await useManualFrames(page);
  const target = `${dev}/__graphic-font-idle__/`;
  await page.route(target, (route) => route.fulfill({
    contentType: "text/html",
    body: '<!doctype html><html><head><title>Graphic font motion</title></head><body><div id="scene"><canvas></canvas></div></body></html>',
  }));
  await page.goto(target);
  await page.evaluate(async () => {
    const { mountCanvas } = await import("/src/lib/lyra-render/mount.ts");
    const root = document.querySelector("#scene");
    root.style.cssText = "width:240px;height:160px";
    root.firstElementChild.style.cssText = "width:100%;height:100%";
    window.__fontMotion = 0;
    window.__fontHandle = mountCanvas(root, {
      duration: 1,
      onResize(state) {
        state.labelFont.widthCssPx("Writing");
        if (state.labelFont.canvasFont.includes("serif")) window.__fontMotion = 3;
      },
      draw() {
        window.__fontMotion = Math.max(0, window.__fontMotion - 1);
        return window.__fontMotion > 0;
      },
    });
  });
  await expect(page.locator("#scene")).toHaveAttribute("data-ready", "true");
  await expect.poll(() => pendingFrames(page)).toBe(1);
  await page.evaluate(() => {
    window.__step(0);
    window.__step(16);
  });
  await expect(page.locator("#scene")).toHaveAttribute("data-motion-state", "still");
  expect(await pendingFrames(page)).toBe(0);
  await page.evaluate(() => {
    document.querySelector("#scene").style.setProperty("--font-mono", "serif");
    document.fonts.dispatchEvent(new Event("loadingdone"));
  });
  await expect(page.locator("#scene")).toHaveAttribute("data-motion-state", "playing");
  expect(await pendingFrames(page)).toBe(1);
  await page.evaluate(() => {
    window.__step(32);
    window.__step(48);
  });
  await expect(page.locator("#scene")).toHaveAttribute("data-motion-state", "still");
  expect(await pendingFrames(page)).toBe(0);
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
    document.documentElement.style.setProperty("--font-mono", '"IBM Plex Sans", sans-serif');
    dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });
  await expect(page.locator("[data-graphic]")).toHaveAttribute("data-ready", "true");
  await settle(page);
  const labels = await assertLabels(page);
  expect(labels[0].font).toContain("IBM Plex Sans");
  expect(await page.evaluate(() => window.__labelMeasureCount)).toBeGreaterThan(measures);
  expect(problems).toEqual([]);
});
