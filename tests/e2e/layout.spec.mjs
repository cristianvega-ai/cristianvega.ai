import { expect, test } from "@playwright/test";

import { settle, VIEWPORTS } from "./fixtures.mjs";

/**
 * Shell contracts that every route owes the reader, checked on all of them at
 * once rather than page by page.
 *
 * This exists because /contact/ and /about/ both shipped a wide page head over
 * a narrow body. Each container was centred, so each looked right on its own,
 * but their left edges sat 170px apart and the page read as tilting right as
 * the eye moved from the headline into the text. A per-page spec did not catch
 * it: the defect is a relationship between containers, and it repeats wherever
 * the pattern is copied.
 */

const ROUTES = [
  "/",
  "/about/",
  "/projects/",
  "/writing/",
  "/contact/",
  "/posts/from-bert-to-agents/",
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

test.describe("the footer is seated", () => {
  /* Deliberately taller than the shortest pages, so the slack is real. */
  test.use({ viewport: { width: 1440, height: 1200 } });

  /* The homepage is `bare` and ships no footer; its hero fills the screen. */
  for (const route of ROUTES.filter((r) => r !== "/")) {
    test(`${route} runs its footer to the foot of the viewport`, async ({ page }) => {
      await page.goto(route);
      await settle(page);

      const seated = await page.evaluate(() => {
        const footer = document.querySelector(".site-footer");
        return footer ? window.innerHeight - footer.getBoundingClientRect().bottom : null;
      });

      // A short page used to end wherever its content did, leaving paper under
      // the ink footer: 82px on /contact/, 402px on the 404.
      expect(seated).not.toBeNull();
      expect(seated).toBeLessThanOrEqual(1);
    });
  }
});
