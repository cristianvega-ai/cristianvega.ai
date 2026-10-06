import { expect, test } from "@playwright/test";

import { paintedPixels, pendingFrames, playFrames, useManualFrames, drawnLabels, edgePaint, GRAPHIC_VIEWPORTS as SIZES, openGraphic as open, settle, textBoxes, useLabelSpy, useReducedMotion, VIEWPORTS } from "./fixtures.mjs";

// Check the 404 graphic, search pulses, and fallback.

const PAGES = {
  notFound: { name: "404 page", url: "/no-such-page-for-the-graphic/", graphic: "[data-graphic='404']", restMs: 31_000 },
};

for (const target of Object.values(PAGES)) {
  test.describe(`the ${target.name} graphic is decorative`, () => {
    test.use({ viewport: VIEWPORTS.desktop });

    test("hides from assistive technology and takes no pointer input", async ({ page }) => {
      await open(page, target);
      const state = await page.evaluate((selector) => {
        const root = document.querySelector(selector);
        return {
          hidden: root.getAttribute("aria-hidden"),
          pointerEvents: [root, root.querySelector("canvas")].map((part) => getComputedStyle(part).pointerEvents),
          canvases: root.querySelectorAll("canvas").length,
          focusable: root.querySelectorAll("a, button, input, select, textarea, [tabindex]").length,
          text: root.textContent.trim(),
          styled: root.querySelectorAll("[style]").length + (root.hasAttribute("style") ? 1 : 0),
          headings: root.querySelectorAll("h1, h2, h3, a").length,
        };
      }, target.graphic);
      expect(state.hidden).toBe("true");
      expect(state.pointerEvents).toEqual(["none", "none"]);
      expect(state.canvases).toBe(1);
      expect(state.focusable).toBe(0);
      expect(state.text).toBe("");
      expect(state.styled, "no style attributes in the markup").toBe(0);
      expect(state.headings, "no heading or link inside the graphic").toBe(0);
    });
  });

  test.describe(`the ${target.name} graphic never overlaps text`, () => {
    for (const size of SIZES) {
      test(`keeps clear of every text box at ${size.width}px`, async ({ page }) => {
        await page.setViewportSize(size);
        await open(page, target);
        await settle(page);
        // The fixed box stays in view. The band scrolls, so it is checked at the top and at the bottom of the page.
        for (const place of ["top", "bottom"]) {
          await page.evaluate((where) => scrollTo(0, where === "top" ? 0 : document.documentElement.scrollHeight), place);
          const shape = await page.locator(target.graphic).evaluate((el) => {
            const rect = el.getBoundingClientRect();
            return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
          });
          expect(shape.w, `${place}: the box has a width`).toBeGreaterThan(100);
          expect(shape.h, `${place}: the box has a height`).toBeGreaterThan(100);
          const texts = await textBoxes(page);
          expect(texts.length).toBeGreaterThan(0);
          for (const text of texts) {
            const apart =
              text.x + text.w <= shape.x || shape.x + shape.w <= text.x || text.y + text.h <= shape.y || shape.y + shape.h <= text.y;
            expect(apart, `${place}: the graphic overlaps a text box at ${JSON.stringify(text)}`).toBe(true);
          }
        }
      });
    }
  });

  test.describe(`the ${target.name} graphic bounds`, () => {
    for (const size of SIZES) {
      test(`keeps every strong mark 28px inside the canvas edge at ${size.width}px`, async ({ page }) => {
        await page.setViewportSize(size);
        await useReducedMotion(page);
        await open(page, target);
        const painted = await edgePaint(page, target.graphic);
        // A band is short, so only the sides count there. The mesh, the star field, and the grid may enter the edge fade.
        const sides = size.width >= 1100 ? ["left", "right", "top", "bottom"] : ["left", "right"];
        for (const side of sides) expect(painted[side], `strong paint at the ${side} edge`).toBe(0);
      });
    }
  });

  test.describe(`the ${target.name} graphic labels`, () => {
    for (const size of SIZES) {
      test(`keep 32px from the viewport edge, clear of the fade, and inside the canvas at ${size.width}px`, async ({ page }) => {
        await page.setViewportSize(size);
        await useLabelSpy(page);
        await useReducedMotion(page);
        await open(page, target);
        const { labels, viewport } = await drawnLabels(page);
        expect(labels.length, "the graphic names Vega").toBeGreaterThan(0);
        expect(labels.map((label) => label.text)).toContain("VEGA · α LYR");
        for (const label of labels) {
          expect(label.left, `"${label.text}" left of the viewport edge`).toBeGreaterThanOrEqual(32);
          expect(label.right, `"${label.text}" right of the viewport edge`).toBeLessThanOrEqual(viewport - 32);
          expect(label.localTop, `"${label.text}" top of the canvas`).toBeGreaterThanOrEqual(16);
          expect(label.localBottom, `"${label.text}" bottom of the canvas`).toBeLessThanOrEqual(label.canvasHeight - 16);
        }
      });
    }

    test("carry an ink halo in the page ground colour", async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.desktop);
      await useLabelSpy(page);
      await useReducedMotion(page);
      await open(page, target);
      const { labels, ink } = await drawnLabels(page);
      expect(labels.length).toBeGreaterThan(0);
      for (const label of labels) {
        expect(label.halo, `"${label.text}" has a halo`).not.toBeNull();
        expect(label.halo.style, `"${label.text}" halo colour`).toBe(ink);
        expect(label.halo.lineJoin).toBe("round");
        expect(label.halo.lineWidth).toBeGreaterThanOrEqual(3);
        expect(label.halo.lineWidth).toBeLessThanOrEqual(4);
      }
    });

    test("fades the canvas edges with a mask", async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.desktop);
      await open(page, target);
      const mask = await page.locator(`${target.graphic} canvas`).evaluate((canvas) => {
        const style = getComputedStyle(canvas);
        return { image: style.maskImage || style.webkitMaskImage, composite: style.maskComposite || style.webkitMaskComposite };
      });
      expect(mask.image).toContain("linear-gradient");
      expect(mask.composite).toMatch(/intersect|source-in/);
    });
  });
}

test.describe("the 404 graphic search", () => {
  test.use({ viewport: VIEWPORTS.desktop });

  test("pulses at about 2.9 s, is calm between pulses, and rests when the last pulse is done", async ({ page }) => {
    await useManualFrames(page);
    await open(page, PAGES.notFound);
    const graphic = PAGES.notFound.graphic;
    const root = page.locator(graphic);
    // The first pulse runs from 2.9 s to 5.5 s. Its middle is at 4.2 s.
    await playFrames(page, 4200);
    const pulsing = await paintedPixels(page, graphic, 8);
    // At 8.5 s the entrance is over and the pulse is gone.
    await playFrames(page, 4300);
    const calm = await paintedPixels(page, graphic, 8);
    expect(pulsing, "a pulse adds paint to the resting picture").toBeGreaterThan(calm);
    await expect(root).toHaveAttribute("data-motion-state", "playing");
    // The last pulse ends at 29.5 s. The picture rests at 30.5 s.
    await playFrames(page, 21_500);
    await expect(root).toHaveAttribute("data-motion-state", "playing");
    await playFrames(page, 1000);
    await expect(root).toHaveAttribute("data-motion-state", "still");
    await expect.poll(() => pendingFrames(page)).toBe(0);
    expect(await paintedPixels(page, graphic, 8), "the resting picture is the picture between pulses").toBe(calm);
  });
});

test.describe("the graphics without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  for (const size of [VIEWPORTS.desktop, VIEWPORTS.mobile]) {
    test(`take no space and show only the 404 page at ${size.width}px`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto(PAGES.notFound.url);
      await expect(page.locator(PAGES.notFound.graphic)).toHaveCSS("display", "none");
      await expect(page.locator("h1")).toBeVisible();
    });
  }
});

test.describe("the 404 graphic in production", () => {
  test("runs with no console error and no CSP violation", async ({ page }) => {
    const problems = [];
    page.on("console", (message) => {
      // The browser logs the 404 status of the page itself. It is not a script error.
      const missingPage = message.location().url.endsWith(PAGES.notFound.url) && message.text().includes("404");
      if ((message.type() === "error" || message.type() === "warning") && !missingPage) problems.push(message.text());
    });
    page.on("pageerror", (error) => problems.push(error.message));
    await page.addInitScript(() => {
      window.__csp = [];
      document.addEventListener("securitypolicyviolation", (event) => window.__csp.push(event.violatedDirective));
    });
    for (const size of [VIEWPORTS.desktop, VIEWPORTS.mobile]) {
      await page.setViewportSize(size);
      const response = await page.goto(PAGES.notFound.url);
      expect(response.status()).toBe(404);
      await expect(page.locator(PAGES.notFound.graphic)).toHaveAttribute("data-ready", "true");
      expect(await page.evaluate(() => window.__csp)).toEqual([]);
    }
    expect(problems).toEqual([]);
  });
});
