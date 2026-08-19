import { expect, test } from "@playwright/test";

import {
  columnCount,
  layoutWidth,
  settle,
  tabTo,
  useReducedMotion,
  VIEWPORTS,
} from "./fixtures.mjs";

/**
 * The about page is one centred column on paper, the same shell every other
 * route uses: a `.wrap` page head over a `.wrap--narrow` body. What the browser
 * has to compute — the resolved measure, the gutters either side of it, the
 * stat band's track count, and the focus ring the page ground selects — is
 * absent from the built HTML, so none of it is reachable from the Node contract
 * tests in tests/*.test.mjs.
 */

const { desktop: DESKTOP, tablet: TABLET, mobile: MOBILE } = VIEWPORTS;

/** The `.wrap--narrow` cap in src/styles/global.css, which the body column reads. */
const NARROW_MEASURE = 840;
/** The `--container` cap, which the page head reads through a plain `.wrap`. */
const CONTAINER_MEASURE = 1180;

const HEAD = "main .page-head";
const HEAD_WRAP = "main .page-head .wrap";
const COLUMN = "main .wrap--narrow";
const STATS = "main .stats";
const CTA = ".about-cta a[href='/contact/']";
const LINKEDIN = ".about-cta a[href*='linkedin.com']";

/**
 * A container's border-box width, and the space left and right of the text it
 * holds. The gutter has to be measured to the content edge, not the box edge:
 * these wrappers carry their gutter as padding, so below the cap the box is
 * full-bleed while the measure inside it is still inset.
 */
async function measure(page, selector) {
  const box = await page.locator(selector).evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return {
      width: rect.width,
      contentLeft: rect.left + parseFloat(style.paddingLeft),
      contentRight: rect.right - parseFloat(style.paddingRight),
    };
  });
  const viewport = await layoutWidth(page);

  return {
    width: box.width,
    centre: (box.contentLeft + box.contentRight) / 2,
    left: box.contentLeft,
    right: viewport - box.contentRight,
  };
}

test.beforeEach(async ({ page }) => {
  await page.goto("/about/");
  await settle(page);
});

test.describe("one centred column at desktop width", () => {
  test.use({ viewport: DESKTOP });

  test("the body column is capped at the narrow measure", async ({ page }) => {
    const column = await measure(page, COLUMN);
    const head = await measure(page, HEAD_WRAP);

    // Capped, not filling: the viewport is far wider than either container.
    expect(column.width).toBeCloseTo(NARROW_MEASURE, 0);
    expect(head.width).toBeCloseTo(CONTAINER_MEASURE, 0);
    expect(column.width).toBeLessThan(head.width);
  });

  test("the body column sits centred, with equal gutters", async ({ page }) => {
    const column = await measure(page, COLUMN);

    // The old split parked this content in the right-hand track, against a
    // sticky ink rail. Centred means the slack divides evenly instead.
    expect(column.left).toBeGreaterThan(0);
    expect(Math.abs(column.left - column.right)).toBeLessThanOrEqual(1);
  });

  test("the page head and the body column share one centre line", async ({ page }) => {
    const head = await measure(page, HEAD_WRAP);
    const column = await measure(page, COLUMN);

    // Two different caps, one axis: the head is wider, but nothing is offset.
    expect(Math.abs(head.centre - column.centre)).toBeLessThanOrEqual(1);
  });
});

test.describe("the surviving stat band", () => {
  test.use({ viewport: DESKTOP });

  test("the page carries one stat band, the independent project's, 4-up", async ({ page }) => {
    // The rail's own band went with the rail. This one belongs to OpenCatalyst
    // and must not be collateral: a second band here means the wrong one lived.
    await expect(page.locator(STATS)).toHaveCount(1);
    await expect(page.locator(`${STATS} .stat__value`).first()).toHaveText("60K");
    expect(await columnCount(page, STATS)).toBe(4);
  });

  test("the band folds to 2-up once the column is narrow", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    expect(await columnCount(page, STATS)).toBe(2);
  });
});

test.describe("narrow viewports", () => {
  for (const [name, viewport] of [
    ["tablet", TABLET],
    ["mobile", MOBILE],
  ]) {
    test(`${name} leaves the document free of horizontal overflow`, async ({ page }) => {
      await page.setViewportSize(viewport);

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));

      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    });

    test(`the column stays centred inside the ${name} viewport`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const column = await measure(page, COLUMN);

      expect(column.left).toBeGreaterThan(0);
      expect(Math.abs(column.left - column.right)).toBeLessThanOrEqual(1);
    });
  }
});

test.describe("document semantics", () => {
  test.use({ viewport: DESKTOP });

  test("the page head carries the page's only h1", async ({ page }) => {
    const h1 = page.locator("h1");
    await expect(h1).toHaveCount(1);
    await expect(page.locator(`${HEAD} h1`)).toHaveCount(1);
  });

  test("heading levels descend without skipping", async ({ page }) => {
    const levels = await page
      .locator("main :is(h1, h2, h3, h4, h5, h6)")
      .evaluateAll((nodes) => nodes.map((node) => Number(node.tagName[1])));

    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
    }
  });

  test("the skip link reaches the content wrapper", async ({ page }) => {
    await page.keyboard.press("Tab");
    const skip = page.locator("a.skip-link");
    await expect(skip).toBeFocused();

    const target = await skip.evaluate((el) => el.getAttribute("href"));
    await expect(page.locator(target)).toHaveCount(1);
  });

  test("the external profile link is safely rel-scoped", async ({ page }) => {
    const linkedin = page.locator(LINKEDIN);
    await expect(linkedin).toHaveAttribute("target", "_blank");

    const rel = await linkedin.getAttribute("rel");
    expect(rel).toContain("noopener");
    expect(rel).toContain("noreferrer");
    expect(rel).toContain("me");
  });

  test("the contact call to action takes the paper focus ring", async ({ page }) => {
    expect(await tabTo(page, CTA)).toBe(true);

    const focus = await page.locator(CTA).evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        visible: el.matches(":focus-visible"),
        style: style.outlineStyle,
        width: parseFloat(style.outlineWidth),
        color: style.outlineColor,
      };
    });

    // This control now stands on paper, so it takes the document's crimson ring
    // (4.50 on paper). The ember ring it used to take belongs to ink grounds,
    // and would sit at 2.31 here.
    expect(focus.visible).toBe(true);
    expect(focus.style).toBe("solid");
    expect(focus.width).toBe(2);
    expect(focus.color).toBe("rgb(212, 42, 60)");
  });
});

test.describe("reduced motion", () => {
  test.use({ viewport: DESKTOP });

  test("the content is readable and no entrance is attached", async ({ page }) => {
    // beforeEach navigated with motion on, so emulate and reload to put the
    // preference in force before the page runs its own entrance.
    await useReducedMotion(page);
    await page.reload();
    await settle(page);

    // Assert the emulation took. Without this the whole block passes while
    // running at full motion, which is exactly how it silently did nothing.
    const reduced = await page.evaluate(
      () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
    expect(reduced).toBe(true);

    // The entrance lives under (prefers-reduced-motion: no-preference), so
    // honouring the preference means no animation is attached at all — the
    // claim that separates a real reduced-motion run from an ordinary one.
    const running = await page.locator("main").evaluate((el) => el.getAnimations().length);
    expect(running).toBe(0);

    await expect(page.locator(`${HEAD} h1`)).toBeVisible();
    await expect(page.locator(`${COLUMN} .about-block`).first()).toBeVisible();
    await expect(page.locator(CTA)).toBeVisible();
  });
});
