import { expect, test } from "@playwright/test";

import { DRAFT_ORIGIN as dev, openGraphic as open, paintedPixels, pendingFrames, playFrames, useManualFrames, useReducedMotion, VIEWPORTS } from "./fixtures.mjs";

// Check shared entrance, pause, and restore contracts through page graphics.

const preview = dev;

const PAGES = {
  products: { name: "products index", url: `${dev}/products/`, graphic: "[data-graphic='products']", restMs: 31_000 },
  product: { name: "product page", url: `${dev}/products/lorem-ipsum-dolor/`, graphic: "[data-graphic='products']", restMs: 31_000 },
  notFound: { name: "404 page", url: "/no-such-page-for-the-graphic/", graphic: "[data-graphic='404']", restMs: 31_000 },
};

for (const target of Object.values(PAGES)) {

  test.describe(`the ${target.name} graphic entrance`, () => {
    test.use({ viewport: VIEWPORTS.desktop });

    test("starts playing, paints more as it goes, and rests after the last frame of motion", async ({ page }) => {
      await useManualFrames(page);
      await open(page, target);
      const root = page.locator(target.graphic);
      await expect(root).toHaveAttribute("data-motion-state", "playing");
      await playFrames(page, 32);
      const early = await paintedPixels(page, target.graphic, 8);
      await playFrames(page, 1200);
      const middle = await paintedPixels(page, target.graphic, 8);
      expect(early, "the first frame is nearly empty").toBeLessThan(middle);
      // The entrance is over at 2.3 s. The picture still moves, so it is not at rest yet.
      await playFrames(page, 2000);
      await expect(root).toHaveAttribute("data-motion-state", "playing");
      expect(await pendingFrames(page), "a frame stays queued while the picture moves").toBe(1);
      // Play on past the end of the motion.
      await playFrames(page, target.restMs);
      await expect(root).toHaveAttribute("data-motion-state", "still");
      await expect.poll(() => pendingFrames(page), "no frame stays queued at rest").toBe(0);
      expect(middle, "the middle of the entrance holds part of the picture").toBeLessThan(await paintedPixels(page, target.graphic, 8));
    });

    test("reduced motion paints the finished picture on the first frame and runs no frames", async ({ page }) => {
      await useManualFrames(page);
      await useReducedMotion(page);
      await open(page, target);
      await expect(page.locator(target.graphic)).toHaveAttribute("data-motion-state", "still");
      expect(await pendingFrames(page)).toBe(0);
      expect(await paintedPixels(page, target.graphic, 8), "the whole picture shows at once").toBeGreaterThan(2500);
    });

    test("a live change to reduced motion finishes the picture at once", async ({ page }) => {
      await useManualFrames(page);
      await open(page, target);
      await expect(page.locator(target.graphic)).toHaveAttribute("data-motion-state", "playing");
      await useReducedMotion(page);
      await expect(page.locator(target.graphic)).toHaveAttribute("data-motion-state", "still");
      expect(await pendingFrames(page)).toBe(0);
    });
  });

  test.describe(`the ${target.name} graphic pauses and tears down`, () => {
    test("stops its frames when the band scrolls off-screen, and resumes on return", async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobile);
      await useManualFrames(page);
      await open(page, target);
      await expect.poll(() => pendingFrames(page), "frames run while the band shows").toBe(1);
      // Make the page longer than the screen, so the band can leave it.
      await page.evaluate(() => {
        const spacer = document.createElement("div");
        spacer.style.height = "3000px";
        document.querySelector("main").append(spacer);
      });
      await page.evaluate(() => scrollTo(0, 1500));
      await expect.poll(() => pendingFrames(page), "no frame is queued off-screen").toBe(0);
      await page.evaluate(() => scrollTo(0, 0));
      await expect.poll(() => pendingFrames(page), "frames resume on return").toBe(1);
    });

    test("stops its frames while the tab is hidden, and resumes when it shows", async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.desktop);
      await useManualFrames(page);
      await open(page, target);
      await expect.poll(() => pendingFrames(page)).toBe(1);
      const setHidden = (hidden) =>
        page.evaluate((value) => {
          Object.defineProperty(document, "hidden", { configurable: true, get: () => value });
          document.dispatchEvent(new Event("visibilitychange"));
        }, hidden);
      await setHidden(true);
      expect(await pendingFrames(page), "no frame is queued in a hidden tab").toBe(0);
      await setHidden(false);
      expect(await pendingFrames(page), "frames resume when the tab shows").toBe(1);
    });

    test("cancels its frames on pagehide and sets up again on a restored page", async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.desktop);
      await useManualFrames(page);
      await open(page, target);
      await expect.poll(() => pendingFrames(page)).toBe(1);

      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
      expect(await pendingFrames(page), "no frame stays queued after pagehide").toBe(0);
      await expect(page.locator(target.graphic)).not.toHaveAttribute("data-ready", /.*/);
      await expect(page.locator(target.graphic)).not.toHaveAttribute("data-motion-state", /.*/);

      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
      await expect(page.locator(target.graphic)).toHaveAttribute("data-ready", "true");
      await expect.poll(() => pendingFrames(page), "frames resume after a restored page").toBe(1);
    });
  });
}

test.describe("the about graphic entrance", () => {
  const graphic = "[data-graphic='about']";

  test.use({ viewport: VIEWPORTS.desktop });

  test("plays, then rests in the still state", async ({ page }) => {
    await page.goto("/about/");
    await expect(page.locator(graphic)).toHaveAttribute("data-motion-state", "still", { timeout: 10_000 });
    await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
  });

  test("starts playing, paints more as it goes, and ends at rest", async ({ page }) => {
    await useManualFrames(page);
    await page.goto("/about/");
    await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
    await expect(page.locator(graphic)).toHaveAttribute("data-motion-state", "playing");
    await playFrames(page, 32);
    const early = await paintedPixels(page, graphic, 8);
    await playFrames(page, 1000);
    const middle = await paintedPixels(page, graphic, 8);
    await playFrames(page, 2000);
    await expect(page.locator(graphic)).toHaveAttribute("data-motion-state", "still");
    const done = await paintedPixels(page, graphic, 8);
    expect(early, "the first frame is nearly empty").toBeLessThan(middle);
    expect(middle, "the middle of the entrance holds part of the picture").toBeLessThan(done);
    // The entrance is over and the marker has settled, so no frame stays queued.
    await expect.poll(() => pendingFrames(page)).toBe(0);
  });

  test("a live change to reduced motion finishes the picture at once", async ({ page }) => {
    await useManualFrames(page);
    await page.goto("/about/");
    await expect(page.locator(graphic)).toHaveAttribute("data-motion-state", "playing");
    await useReducedMotion(page);
    await expect(page.locator(graphic)).toHaveAttribute("data-motion-state", "still");
    expect(await pendingFrames(page)).toBe(0);
  });
});

test.describe("the about graphic pauses and tears down", () => {
  const graphic = "[data-graphic='about']";

  test("stops its frames when the band scrolls off-screen, and resumes on return", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await useManualFrames(page);
    await page.goto("/about/");
    await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
    await expect.poll(() => pendingFrames(page), "frames run while the band shows").toBe(1);
    await page.evaluate(() => scrollTo(0, 1500));
    await expect.poll(() => pendingFrames(page), "no frame is queued off-screen").toBe(0);
    await page.evaluate(() => scrollTo(0, 0));
    await expect.poll(() => pendingFrames(page), "frames resume on return").toBe(1);
  });

  test("stops its frames while the tab is hidden, and resumes when it shows", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await useManualFrames(page);
    await page.goto("/about/");
    await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
    await expect.poll(() => pendingFrames(page)).toBe(1);
    const setHidden = (hidden) =>
      page.evaluate((value) => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => value });
        document.dispatchEvent(new Event("visibilitychange"));
      }, hidden);
    await setHidden(true);
    expect(await pendingFrames(page), "no frame is queued in a hidden tab").toBe(0);
    await setHidden(false);
    expect(await pendingFrames(page), "frames resume when the tab shows").toBe(1);
  });

  test("cancels its frames on pagehide and sets up again on a restored page", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await useManualFrames(page);
    await page.goto("/about/");
    await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
    await expect.poll(() => pendingFrames(page)).toBe(1);

    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
    expect(await pendingFrames(page), "no frame stays queued after pagehide").toBe(0);
    await expect(page.locator(graphic)).not.toHaveAttribute("data-ready", /.*/);
    await expect(page.locator(graphic)).not.toHaveAttribute("data-motion-state", /.*/);

    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
    await expect.poll(() => pendingFrames(page), "frames resume after a restored page").toBe(1);
  });
});

test.describe("the writing graphic entrance", () => {
  const graphic = "[data-graphic='writing']";

  test.use({ viewport: VIEWPORTS.desktop });

  test("plays, then rests in the still state", async ({ page }) => {
    await page.goto(preview + "/writing/");
    await expect(page.locator(graphic)).toHaveAttribute("data-motion-state", "still", { timeout: 10_000 });
    });

  test("paints more as it goes, and ends at rest with no queued frame", async ({ page }) => {
    await useManualFrames(page);
    await page.goto(preview + "/writing/");
    await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
    await expect(page.locator(graphic)).toHaveAttribute("data-motion-state", "playing");
    await playFrames(page, 32);
    const early = await paintedPixels(page, graphic, 8);
    await playFrames(page, 1000);
    const middle = await paintedPixels(page, graphic, 8);
    await playFrames(page, 2000);
    await expect(page.locator(graphic)).toHaveAttribute("data-motion-state", "still");
    const done = await paintedPixels(page, graphic, 8);
    expect(early).toBeLessThan(middle);
    expect(middle).toBeLessThan(done);
    await expect.poll(() => pendingFrames(page)).toBe(0);
  });

  test("reduced motion paints the finished picture on the first frame and runs no frames", async ({ page }) => {
    await useManualFrames(page);
    await useReducedMotion(page);
    await page.goto(preview + "/writing/");
    await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
    await expect(page.locator(graphic)).toHaveAttribute("data-motion-state", "still");
    expect(await pendingFrames(page)).toBe(0);
    expect(await paintedPixels(page, graphic, 8), "every star, synapse, and label is drawn at once").toBeGreaterThan(3000);
  });

  test("a live change to reduced motion finishes the picture at once", async ({ page }) => {
    await useManualFrames(page);
    await page.goto(preview + "/writing/");
    await expect(page.locator(graphic)).toHaveAttribute("data-motion-state", "playing");
    await useReducedMotion(page);
    await expect(page.locator(graphic)).toHaveAttribute("data-motion-state", "still");
    expect(await pendingFrames(page)).toBe(0);
  });
});

test.describe("the writing graphic pauses and tears down", () => {
  const graphic = "[data-graphic='writing']";

  test("stops its frames when it scrolls off-screen, and resumes on return", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await useManualFrames(page);
    await page.goto(preview + "/writing/");
    await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
    expect(await pendingFrames(page), "frames run while the graphic shows").toBe(1);
    await page.evaluate(() => scrollTo(0, 1500));
    await expect.poll(() => pendingFrames(page), "no frame is queued off-screen").toBe(0);
    await page.evaluate(() => scrollTo(0, 0));
    await expect.poll(() => pendingFrames(page), "frames resume on return").toBe(1);
  });

  test("stops its frames while the tab is hidden, and resumes when it shows", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await useManualFrames(page);
    await page.goto(preview + "/writing/");
    await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
    expect(await pendingFrames(page)).toBe(1);
    const setHidden = (hidden) =>
      page.evaluate((value) => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => value });
        document.dispatchEvent(new Event("visibilitychange"));
      }, hidden);
    await setHidden(true);
    expect(await pendingFrames(page), "no frame is queued in a hidden tab").toBe(0);
    await setHidden(false);
    expect(await pendingFrames(page), "frames resume when the tab shows").toBe(1);
  });
});
