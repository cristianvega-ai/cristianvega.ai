import { expect, test } from "@playwright/test";

import { bandHeight, drawnLabels, edgePaint, settle, textBoxes, useLabelSpy, useManualFrames, useReducedMotion, VIEWPORTS } from "./fixtures.mjs";

/**
 * The products graphic ("Constellation lattice") and the 404 graphic ("Missing star").
 * Both use the shared page graphic module, so the pause and teardown rules are
 * checked through these pages as well. The products pages exist only on the draft
 * preview server. The 404 page exists in the production build.
 */

const dev = "http://127.0.0.1:4324";
const PAGES = {
  products: { name: "products index", url: `${dev}/products/`, graphic: "[data-graphic='products']", restMs: 31_000 },
  product: { name: "product page", url: `${dev}/products/lorem-ipsum-dolor/`, graphic: "[data-graphic='products']", restMs: 31_000 },
  notFound: { name: "404 page", url: "/no-such-page-for-the-graphic/", graphic: "[data-graphic='404']", restMs: 31_000 },
};
const SIZES = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 820, height: 1180 },
  { width: 390, height: 844 },
];

const pending = (page) => page.evaluate(() => window.__pending());

/** Open a page and wait for its graphic. The draft server compiles a page on the first visit, so the wait is long. */
async function open(page, target) {
  await page.goto(target.url);
  await expect(page.locator(target.graphic)).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
}

/**
 * Play the manual clock forward by a number of milliseconds, in 16 ms frames.
 * A frame counts at most 64 ms of time, so a test cannot jump over the entrance in one step.
 */
const play = (page, ms) =>
  page.evaluate((span) => {
    window.__time = window.__time ?? 0;
    for (let end = window.__time + span; window.__time < end; ) {
      window.__time += 16;
      window.__step(window.__time);
    }
  }, ms);

/** The count of canvas pixels that hold any paint. */
const paintedPixels = (page, graphic) =>
  page.locator(`${graphic} canvas`).evaluate((canvas) => {
    const { data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 8) count += 1;
    return count;
  });

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

  test.describe(`the ${target.name} graphic entrance`, () => {
    test.use({ viewport: VIEWPORTS.desktop });

    test("starts playing, paints more as it goes, and rests after the last frame of motion", async ({ page }) => {
      await useManualFrames(page);
      await open(page, target);
      const root = page.locator(target.graphic);
      await expect(root).toHaveAttribute("data-motion-state", "playing");
      await play(page, 32);
      const early = await paintedPixels(page, target.graphic);
      await play(page, 1200);
      const middle = await paintedPixels(page, target.graphic);
      expect(early, "the first frame is nearly empty").toBeLessThan(middle);
      // The entrance is over at 2.3 s. The picture still moves, so it is not at rest yet.
      await play(page, 2000);
      await expect(root).toHaveAttribute("data-motion-state", "playing");
      expect(await pending(page), "a frame stays queued while the picture moves").toBe(1);
      // Play on past the end of the motion.
      await play(page, target.restMs);
      await expect(root).toHaveAttribute("data-motion-state", "still");
      await expect.poll(() => pending(page), "no frame stays queued at rest").toBe(0);
      expect(middle, "the middle of the entrance holds part of the picture").toBeLessThan(await paintedPixels(page, target.graphic));
    });

    test("reduced motion paints the finished picture on the first frame and runs no frames", async ({ page }) => {
      await useManualFrames(page);
      await useReducedMotion(page);
      await open(page, target);
      await expect(page.locator(target.graphic)).toHaveAttribute("data-motion-state", "still");
      expect(await pending(page)).toBe(0);
      expect(await paintedPixels(page, target.graphic), "the whole picture shows at once").toBeGreaterThan(2500);
    });

    test("a live change to reduced motion finishes the picture at once", async ({ page }) => {
      await useManualFrames(page);
      await open(page, target);
      await expect(page.locator(target.graphic)).toHaveAttribute("data-motion-state", "playing");
      await useReducedMotion(page);
      await expect(page.locator(target.graphic)).toHaveAttribute("data-motion-state", "still");
      expect(await pending(page)).toBe(0);
    });
  });

  test.describe(`the ${target.name} graphic pauses and tears down`, () => {
    test("stops its frames when the band scrolls off-screen, and resumes on return", async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobile);
      await useManualFrames(page);
      await open(page, target);
      await expect.poll(() => pending(page), "frames run while the band shows").toBe(1);
      // Make the page longer than the screen, so the band can leave it.
      await page.evaluate(() => {
        const spacer = document.createElement("div");
        spacer.style.height = "3000px";
        document.querySelector("main").append(spacer);
      });
      await page.evaluate(() => scrollTo(0, 1500));
      await expect.poll(() => pending(page), "no frame is queued off-screen").toBe(0);
      await page.evaluate(() => scrollTo(0, 0));
      await expect.poll(() => pending(page), "frames resume on return").toBe(1);
    });

    test("stops its frames while the tab is hidden, and resumes when it shows", async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.desktop);
      await useManualFrames(page);
      await open(page, target);
      await expect.poll(() => pending(page)).toBe(1);
      const setHidden = (hidden) =>
        page.evaluate((value) => {
          Object.defineProperty(document, "hidden", { configurable: true, get: () => value });
          document.dispatchEvent(new Event("visibilitychange"));
        }, hidden);
      await setHidden(true);
      expect(await pending(page), "no frame is queued in a hidden tab").toBe(0);
      await setHidden(false);
      expect(await pending(page), "frames resume when the tab shows").toBe(1);
    });

    test("cancels its frames on pagehide and sets up again on a restored page", async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.desktop);
      await useManualFrames(page);
      await open(page, target);
      await expect.poll(() => pending(page)).toBe(1);

      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
      expect(await pending(page), "no frame stays queued after pagehide").toBe(0);
      await expect(page.locator(target.graphic)).not.toHaveAttribute("data-ready", /.*/);
      await expect(page.locator(target.graphic)).not.toHaveAttribute("data-motion-state", /.*/);

      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
      await expect(page.locator(target.graphic)).toHaveAttribute("data-ready", "true");
      await expect.poll(() => pending(page), "frames resume after a restored page").toBe(1);
    });
  });
}

test.describe("the products graphic shows the products", () => {
  test.use({ viewport: VIEWPORTS.desktop });

  test("exposes the lit-product count, and it matches the list", async ({ page }) => {
    await open(page, PAGES.products);
    const listed = await page.locator(".entries--products .entries__item").count();
    expect(listed).toBeGreaterThan(0);
    await expect(page.locator(PAGES.products.graphic)).toHaveAttribute("data-products", String(listed));
  });

  test("a product page shows the same count and marks its own star", async ({ page }) => {
    await open(page, PAGES.products);
    const listed = await page.locator(".entries--products .entries__item").count();
    await open(page, PAGES.product);
    const root = page.locator(PAGES.product.graphic);
    await expect(root).toHaveAttribute("data-products", String(listed));
    await expect(root).toHaveAttribute("data-current", "0");
  });
});

test.describe("the 404 graphic search", () => {
  test.use({ viewport: VIEWPORTS.desktop });

  test("pulses at about 2.9 s, is calm between pulses, and rests when the last pulse is done", async ({ page }) => {
    await useManualFrames(page);
    await open(page, PAGES.notFound);
    const graphic = PAGES.notFound.graphic;
    const root = page.locator(graphic);
    // The first pulse runs from 2.9 s to 5.5 s. Its middle is at 4.2 s.
    await play(page, 4200);
    const pulsing = await paintedPixels(page, graphic);
    // At 8.5 s the entrance is over and the pulse is gone.
    await play(page, 4300);
    const calm = await paintedPixels(page, graphic);
    expect(pulsing, "a pulse adds paint to the resting picture").toBeGreaterThan(calm);
    await expect(root).toHaveAttribute("data-motion-state", "playing");
    // The last pulse ends at 29.5 s. The picture rests at 30.5 s.
    await play(page, 21_500);
    await expect(root).toHaveAttribute("data-motion-state", "playing");
    await play(page, 1000);
    await expect(root).toHaveAttribute("data-motion-state", "still");
    await expect.poll(() => pending(page)).toBe(0);
    expect(await paintedPixels(page, graphic), "the resting picture is the picture between pulses").toBe(calm);
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

test.describe("the graphic bands share one height below 1100px", () => {
  for (const size of [{ width: 1024, height: 768 }, { width: 820, height: 1180 }, VIEWPORTS.mobile, { width: 360, height: 740 }, { width: 820, height: 2000 }]) {
    test(`about, products, the 404 page, and the homepage hold the shared band height at ${size.width}x${size.height}`, async ({ page }) => {
      await page.setViewportSize(size);
      const heights = [];
      for (const target of [PAGES.products, PAGES.notFound, { url: `${dev}/about/`, graphic: "[data-graphic='about']" }, { url: "/", graphic: ".hero__globe [data-lyra-globe]" }]) {
        await open(page, target);
        heights.push(await page.locator(target.graphic).evaluate((el) => el.getBoundingClientRect().height));
      }
      for (const height of heights) {
        expect(Math.abs(height - bandHeight(size.height)), `band heights ${heights}`).toBeLessThanOrEqual(1);
      }
    });
  }
});
