import { expect, test } from "@playwright/test";

import { pageProblems, settle, useReducedMotion, VIEWPORTS } from "./fixtures.mjs";

const graphic = "[data-graphic='about']";

async function useSkyToken(page, token) {
  await page.addInitScript((color) => {
    const apply = () => {
      if (!document.documentElement) return false;
      document.documentElement.style.setProperty("--sky", color, "important");
      return true;
    };
    if (!apply()) {
      const observer = new MutationObserver(() => {
        if (apply()) observer.disconnect();
      });
      observer.observe(document, { childList: true, subtree: true });
    }

    window.__glowStops = [];
    const addColorStop = CanvasGradient.prototype.addColorStop;
    CanvasGradient.prototype.addColorStop = function (offset, value) {
      if (value.startsWith("rgba(")) window.__glowStops.push(value);
      return addColorStop.call(this, offset, value);
    };
  }, token);
}

function watchProblems(page) {
  const problems = pageProblems(page);
  const warnings = [];
  page.on("console", (message) => {
    if (message.type() === "warning") warnings.push(message.text());
  });
  return { problems, warnings };
}

const parseStop = (stop) => stop.match(/^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/)?.slice(1).map(Number);

// Any color that the browser parses paints as itself. A value that it cannot parse paints the fallback and warns.
// A missing token paints the fallback without a warning.
const SKY_TOKENS = [
  { name: "the current hex color", token: "#38BDF8", rgb: [56, 189, 248] },
  { name: "a mixed-case hex color", token: "#aBcDeF", rgb: [171, 205, 239] },
  { name: "a trimmed hex color", token: "  #38BDF8  ", rgb: [56, 189, 248] },
  { name: "an RGB color", token: "rgb(56, 189, 248)", rgb: [56, 189, 248] },
  { name: "a short hex color", token: "#3bf", rgb: [51, 187, 255] },
  { name: "an HSL color", token: "hsl(198, 93%, 60%)", rgb: [58, 191, 248] },
  { name: "an OKLCH color", token: "oklch(0.7 0.18 50)" },
  { name: "a named color", token: "orange", rgb: [255, 165, 0] },
  { name: "a hex color with alpha", token: "#FF8000AA", rgb: [255, 128, 0], alpha: 170 / 255 },
  { name: "a transparent color", token: "transparent", rgb: [0, 0, 0], alpha: 0 },
  { name: "an empty token fallback", token: " ", rgb: [56, 189, 248], fallback: true },
  { name: "an invalid hex fallback", token: "#38BDGG", rgb: [56, 189, 248], fallback: true, warns: true },
  { name: "an unknown word fallback", token: "not-a-color", rgb: [56, 189, 248], fallback: true, warns: true },
];

test.describe("graphic sky colors", () => {
  for (const viewport of Object.values(VIEWPORTS)) {
    for (const { name, token, rgb, alpha = 1, warns = false } of SKY_TOKENS) {
      test(`paints ${name} at ${viewport.width}px`, async ({ page }) => {
        const { problems, warnings } = watchProblems(page);
        await page.setViewportSize(viewport);
        await useReducedMotion(page);
        await useSkyToken(page, token);
        await page.goto("/about/");
        await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
        await expect(page.locator(graphic)).toHaveAttribute("data-motion-state", "still");
        await settle(page);
        await expect(page.locator("h1")).toBeVisible();
        await expect(page.locator(".about__lede")).toBeVisible();
        expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--sky").trim())).toBe(token.trim());

        // Without a fixed expectation, the browser resolves the color through a canvas of its own.
        const expected = rgb ?? await page.evaluate((value) => {
          const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
          context.fillStyle = value;
          context.fillRect(0, 0, 1, 1);
          return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
        }, token);
        const stops = (await page.evaluate(() => window.__glowStops)).map(parseStop);
        expect(stops, "one glow sprite with two stops").toHaveLength(2);
        for (const [index, stop] of stops.entries()) {
          for (const channel of [0, 1, 2]) expect(Math.abs(stop[channel] - expected[channel]), `stop ${index} channel ${channel}`).toBeLessThanOrEqual(1);
        }
        expect(Math.abs(stops[0][3] - 0.45 * alpha), "the glow keeps the color alpha").toBeLessThanOrEqual(0.002);
        expect(stops[1][3]).toBe(0);
        if (!rgb) expect(stops[0].slice(0, 3).join(), "the color does not fall back").not.toBe("56,189,248");
        const skyWarnings = warnings.filter((warning) => warning.includes("--sky"));
        expect(skyWarnings, warns ? "an invalid token warns once" : "a valid or missing token does not warn").toHaveLength(warns ? 1 : 0);

        const accentPixels = await page.locator(`${graphic} canvas`).evaluate((canvas, color) => {
          const { data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
          let count = 0;
          for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] > 24 && color.every((channel, index) => Math.abs(data[i + index] - channel) <= 3)) count += 1;
          }
          return count;
        }, expected);
        if (alpha > 0) expect(accentPixels, "the graphic must paint the selected sky color").toBeGreaterThan(25);
        expect(problems).toEqual([]);
      });
    }

    test(`keeps content visible without canvas at ${viewport.width}px`, async ({ page }) => {
      const { problems } = watchProblems(page);
      await page.setViewportSize(viewport);
      await useReducedMotion(page);
      await useSkyToken(page, "rgb(56, 189, 248)");
      await page.addInitScript(() => {
        HTMLCanvasElement.prototype.getContext = () => null;
      });
      await page.goto("/about/");
      await expect(page.locator(graphic)).toBeHidden();
      await expect(page.locator(graphic)).toHaveAttribute("hidden", "");
      await settle(page);
      await expect(page.locator("h1")).toBeVisible();
      await expect(page.locator(".about__lede")).toBeVisible();
      expect(problems).toEqual([]);
    });
  }
});
