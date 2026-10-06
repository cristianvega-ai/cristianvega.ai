import { expect, test } from "@playwright/test";

import { settle, useReducedMotion, VIEWPORTS } from "./fixtures.mjs";

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
  const problems = [];
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  return problems;
}

test.describe("graphic sky colors", () => {
  for (const viewport of Object.values(VIEWPORTS)) {
    for (const { name, token, channels } of [
      { name: "the current hex color", token: "#38BDF8", channels: "56, 189, 248" },
      { name: "a mixed-case hex color", token: "#aBcDeF", channels: "171, 205, 239" },
      { name: "a trimmed hex color", token: "  #38BDF8  ", channels: "56, 189, 248" },
      { name: "an empty token fallback", token: " ", channels: "56, 189, 248" },
      { name: "an RGB token fallback", token: "rgb(56, 189, 248)", channels: "56, 189, 248" },
      { name: "a short hex token fallback", token: "#3bf", channels: "56, 189, 248" },
      { name: "an alpha hex token fallback", token: "#38BDF880", channels: "56, 189, 248" },
      { name: "a named color fallback", token: "transparent", channels: "56, 189, 248" },
      { name: "an invalid token fallback", token: "#38BDGG", channels: "56, 189, 248" },
    ]) {
      test(`paints ${name} at ${viewport.width}px`, async ({ page }) => {
        const problems = watchProblems(page);
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
        expect(await page.evaluate(() => window.__glowStops)).toEqual([
          `rgba(${channels}, 0.45)`, `rgba(${channels}, 0)`,
        ]);

        const accentPixels = await page.locator(`${graphic} canvas`).evaluate((canvas, expected) => {
          const { data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
          let count = 0;
          for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] > 8 && expected.every((channel, index) => Math.abs(data[i + index] - channel) <= 2)) count += 1;
          }
          return count;
        }, channels.split(", ").map(Number));
        expect(accentPixels, "the graphic must paint the selected sky color").toBeGreaterThan(25);
        expect(problems).toEqual([]);
      });
    }

    test(`keeps content visible without canvas at ${viewport.width}px`, async ({ page }) => {
      const problems = watchProblems(page);
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
