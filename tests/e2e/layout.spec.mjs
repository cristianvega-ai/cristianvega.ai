import { expect, test } from "@playwright/test";

import { settle, VIEWPORTS } from "./fixtures.mjs";

/**
 * Shell contracts that every route owes the reader, checked on all of them at
 * once rather than page by page.
 *
 * This exists because two retired pages both shipped a wide page head over a
 * narrow body. Each container was centred, so each looked right on its own,
 * but their left edges sat 170px apart and the page read as tilting right as
 * the eye moved from the headline into the text. A per-page spec did not catch
 * it: the defect is a relationship between containers, and it repeats wherever
 * the pattern is copied.
 */

const ROUTES = [
  "/",
  /* Any unknown path: the static host serves 404.html for it. */
  "/no-such-page/",
];

/** Content-edge insets of every page container, ignoring the box's own bleed. */
async function containers(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("main .wrap")].map((el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        left: Math.round(rect.left + parseFloat(style.paddingLeft)),
        right: Math.round(
          document.documentElement.clientWidth - (rect.right - parseFloat(style.paddingRight)),
        ),
      };
    }),
  );
}

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test.describe(`${name} shell`, () => {
    test.use({ viewport });

    for (const route of ROUTES) {
      test(`${route} keeps one left edge and no overflow`, async ({ page }) => {
        await page.goto(route);
        await settle(page);

        const boxes = await containers(page);

        if (route === "/") {
          /* The homepage is `bare`. Its hero runs full bleed on its own grid,
             so it holds no shared container. There is no edge relation to
             check. This asserts the absence instead of skipping the route, so
             a `.wrap` added here later must be aligned on purpose. */
          expect(boxes).toEqual([]);
        } else {
          expect(boxes.length).toBeGreaterThan(0);

          // Every container starts in the same place. Centring each one
          // separately is not enough — two different caps share a centre while
          // starting 170px apart, which is exactly the drift that shipped.
          const lefts = new Set(boxes.map((b) => b.left));
          expect([...lefts]).toHaveLength(1);

          // And each is centred, so the page is not simply inset from one side.
          for (const box of boxes) {
            expect(Math.abs(box.left - box.right)).toBeLessThanOrEqual(1);
          }
        }

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(1);
      });
    }
  });
}

test.describe("document structure", () => {
  test.use({ viewport: VIEWPORTS.desktop });

  for (const route of ROUTES) {
    test(`${route} carries exactly one h1`, async ({ page }) => {
      await page.goto(route);
      await expect(page.locator("h1")).toHaveCount(1);
    });
  }
});

test.describe("the footer holds the foot of the viewport", () => {
  /* Deliberately taller than the shortest pages, so the slack is real. */
  test.use({ viewport: { width: 1440, height: 1200 } });

  for (const route of ROUTES) {
    test(`${route} keeps its footer on screen, clear of the content`, async ({ page }) => {
      await page.goto(route);
      await settle(page);

      // Seated at the foot on arrival. A short page used to end wherever its
      // content did, leaving paper under the ink footer: 82px on a retired
      // page, 402px on the 404.
      const onArrival = await page.evaluate(() => {
        const footer = document.querySelector(".site-footer");
        return footer ? window.innerHeight - footer.getBoundingClientRect().bottom : null;
      });
      expect(onArrival).not.toBeNull();
      expect(onArrival).toBeLessThanOrEqual(1);

      // Still there at the bottom of the scroll. Position fixed makes the
      // check above pass for free, so on its own it proves nothing.
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(120);

      const afterScroll = await page.evaluate(() => {
        const footer = document.querySelector(".site-footer");
        const rect = footer.getBoundingClientRect();
        const main = document.querySelector("#main-content");
        const last = main.getBoundingClientRect().bottom;
        return {
          gap: window.innerHeight - rect.bottom,
          // The bar must never cover the end of the page.
          contentClear: rect.top - last,
        };
      });
      expect(afterScroll.gap).toBeLessThanOrEqual(1);
      expect(afterScroll.contentClear).toBeGreaterThanOrEqual(0);
    });
  }
});

test.describe("the compact header", () => {
  // The 520px block used to hide the wordmark because four labels overflowed
  // in the 421–520px band. The nav now has two (about, contact). Full brand
  // plus those two still fit at 390 and 450, so the name must stay visible.
  for (const width of [450, 390]) {
    test(`keeps the wordmark beside the nav at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/");
      await settle(page);

      const state = await page.evaluate(() => {
        const brand = document.querySelector(".brand");
        const wordmark = document.querySelector(".brand span:last-child");
        const nav = document.querySelector(".nav");
        const brandBox = brand.getBoundingClientRect();
        const navBox = nav.getBoundingClientRect();
        return {
          wordmarkShown: getComputedStyle(wordmark).display !== "none",
          overlap: brandBox.right > navBox.left + 0.5,
        };
      });

      expect(state.wordmarkShown).toBe(true);
      expect(state.overlap).toBe(false);
    });
  }
});

/* Routes that open with a grid band. The homepage opens with the hero. */
const HEAD_ROUTES = ["/no-such-page/"];

test.describe("the grid runs to the top", () => {
  test.use({ viewport: VIEWPORTS.desktop });

  for (const route of HEAD_ROUTES) {
    test(`${route} starts its band behind the header`, async ({ page }) => {
      await page.goto(route);
      await settle(page);

      const top = await page
        .locator("main .page-head")
        .evaluate((el) => el.getBoundingClientRect().top);

      // The band slides under the transparent header, so the grid reaches the
      // top of the page. Stop it at the header and the logo and the nav sit on
      // bare paper, reading as detached from the page under them.
      expect(top).toBeLessThanOrEqual(0.5);
    });
  }
});
