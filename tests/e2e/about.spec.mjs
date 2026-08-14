import { expect, test } from "@playwright/test";

/**
 * The about page's split layout is a computed-layout contract: sticky
 * positioning, a grid that collapses at 960px, and rules keyed to viewport
 * height. None of it is visible in the built HTML, so none of it is reachable
 * from the Node contract tests in tests/*.test.mjs.
 */

const DESKTOP = { width: 1440, height: 900 };
const DESKTOP_SHORT = { width: 1280, height: 720 };
const DESKTOP_TINY = { width: 1280, height: 560 };
const TABLET = { width: 900, height: 1000 };
const MOBILE = { width: 390, height: 844 };

const RAIL = ".about-rail";
const RAIL_INNER = ".about-rail__inner";
const SCROLL = ".about-scroll";
const STATS = ".stats--rail";

/** Viewport-relative top edge, which is what sticky behavior is defined in. */
async function viewportTop(page, selector) {
  return page.locator(selector).evaluate((el) => el.getBoundingClientRect().top);
}

/** Track count of a grid, read off the resolved template rather than the rule. */
async function columnCount(page, selector) {
  const template = await page
    .locator(selector)
    .evaluate((el) => getComputedStyle(el).gridTemplateColumns);
  return template.split(/\s+/).filter(Boolean).length;
}

/** Tab forward until the target holds focus, so :focus-visible genuinely applies. */
async function tabTo(page, selector, limit = 25) {
  const target = page.locator(selector);
  for (let i = 0; i < limit; i += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((el) => el === document.activeElement)) return true;
  }
  return false;
}

/**
 * `[data-page="about"] main` runs a 0.7s developUp entrance that scales and
 * offsets the whole page. Geometry read before it lands is the animation's,
 * not the layout's. Resolves immediately under reduced motion, where the
 * animation never applies.
 */
async function settle(page) {
  await page
    .locator("main")
    .evaluate((el) => Promise.all(el.getAnimations().map((animation) => animation.finished)));
}

test.beforeEach(async ({ page }) => {
  await page.goto("/about/");
  await settle(page);
});

test.describe("pinned rail at desktop width", () => {
  test.use({ viewport: DESKTOP });

  test("the rail and the content column share a row", async ({ page }) => {
    const rail = await page.locator(RAIL).boundingBox();
    const column = await page.locator(SCROLL).boundingBox();

    // Side by side: the rail ends where the content column begins.
    expect(rail.x + rail.width).toBeLessThanOrEqual(column.x + 1);
    // And they genuinely overlap vertically rather than merely not colliding.
    expect(rail.y).toBeLessThan(column.y + column.height);
    expect(column.y).toBeLessThan(rail.y + rail.height);
  });

  test("the rail pins while the content column scrolls past it", async ({ page }) => {
    await expect(page.locator(RAIL_INNER)).toHaveCSS("position", "sticky");

    // Scroll far enough that the rail has reached its pinned offset.
    await page.evaluate(() => window.scrollBy(0, 1200));
    const railBefore = await viewportTop(page, RAIL_INNER);
    const columnBefore = await viewportTop(page, `${SCROLL} .about-block:last-of-type`);

    await page.evaluate(() => window.scrollBy(0, 600));
    const railAfter = await viewportTop(page, RAIL_INNER);
    const columnAfter = await viewportTop(page, `${SCROLL} .about-block:last-of-type`);

    // Pinned: the rail holds its viewport position across further scrolling...
    expect(Math.abs(railAfter - railBefore)).toBeLessThan(2);
    expect(Math.abs(railAfter)).toBeLessThan(2);
    // ...while the content beside it keeps moving by the full scroll delta.
    expect(columnBefore - columnAfter).toBeGreaterThan(500);
  });

  test("the ink ground covers the rail's full column height", async ({ page }) => {
    const rail = await page.locator(RAIL).boundingBox();
    const column = await page.locator(SCROLL).boundingBox();

    // The stretched column is what keeps the seam running the whole page; if the
    // rail only spanned its own content the ink would stop mid-scroll.
    expect(rail.height).toBeGreaterThanOrEqual(column.height - 1);
  });

  test("the stat band is 2-up inside the rail's measure", async ({ page }) => {
    expect(await columnCount(page, STATS)).toBe(2);
  });

  test("the rail's contact controls take visible focus on ink", async ({ page }) => {
    const cta = `${RAIL} a[href="/contact/"]`;
    expect(await tabTo(page, cta)).toBe(true);

    const focus = await page.locator(cta).evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        visible: el.matches(":focus-visible"),
        style: style.outlineStyle,
        width: parseFloat(style.outlineWidth),
      };
    });

    expect(focus.visible).toBe(true);
    expect(focus.style).not.toBe("none");
    expect(focus.width).toBeGreaterThanOrEqual(3);
  });
});

test.describe("short desktop viewports", () => {
  test("the trimmed rail fits a 720px-tall viewport without inner scrolling", async ({ page }) => {
    await page.setViewportSize(DESKTOP_SHORT);
    const fit = await page.locator(RAIL_INNER).evaluate((el) => ({
      content: el.scrollHeight,
      visible: el.clientHeight,
    }));

    // The height-keyed trim exists precisely so the backstop never engages here.
    expect(fit.content).toBeLessThanOrEqual(fit.visible + 1);
  });

  /**
   * At rest the rail sits below the header, so it has less room than 100dvh.
   * Measuring only its internal overflow misses a rail that fits itself while
   * still running off the screen — which is exactly how this regressed: the
   * block was sized to a bare 100dvh and pushed its last control 14px past the
   * bottom edge. The clamp has to subtract the header, not assume the viewport.
   */
  for (const [name, viewport] of [
    ["720px-tall", DESKTOP_SHORT],
    ["560px-tall", DESKTOP_TINY],
  ]) {
    test(`the unpinned rail stays inside a ${name} viewport`, async ({ page }) => {
      await page.setViewportSize(viewport);

      const overhang = await page
        .locator(RAIL_INNER)
        .evaluate((el) => el.getBoundingClientRect().bottom - window.innerHeight);

      expect(overhang).toBeLessThanOrEqual(0);
    });
  }

  test("the rail's controls are on screen at 720px without scrolling", async ({ page }) => {
    await page.setViewportSize(DESKTOP_SHORT);

    await expect(page.locator(`${RAIL} a[href="/contact/"]`)).toBeInViewport();
    await expect(page.locator(`${RAIL} a[href*="linkedin.com"]`)).toBeInViewport();
  });

  test("a viewport too short to fit the rail still reaches the last control", async ({ page }) => {
    await page.setViewportSize(DESKTOP_TINY);
    const linkedin = page.locator(`${RAIL} a[href*="linkedin.com"]`);

    // Backstop: the rail scrolls internally rather than clipping past the pin.
    await linkedin.scrollIntoViewIfNeeded();
    await expect(linkedin).toBeInViewport();
  });
});

test.describe("stacked layout below 960px", () => {
  for (const [name, viewport] of [
    ["tablet", TABLET],
    ["mobile", MOBILE],
  ]) {
    test(`the rail becomes a full-width masthead at ${name} width`, async ({ page }) => {
      await page.setViewportSize(viewport);

      // Nothing to pin against once stacked, so the sticky must be released.
      await expect(page.locator(RAIL_INNER)).toHaveCSS("position", "static");

      const rail = await page.locator(RAIL).boundingBox();
      const column = await page.locator(SCROLL).boundingBox();

      expect(rail.y + rail.height).toBeLessThanOrEqual(column.y + 1);

      // Against the layout viewport, not the nominal width: a classic scrollbar
      // legitimately narrows the former and would make this flap.
      const layoutWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(rail.width).toBeCloseTo(layoutWidth, 0);
    });
  }

  test("the stat band opens to 4-up once the masthead is full width", async ({ page }) => {
    await page.setViewportSize(TABLET);
    expect(await columnCount(page, STATS)).toBe(4);
  });

  test("mobile leaves the document free of horizontal overflow", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));

    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
  });
});

test.describe("document semantics", () => {
  test.use({ viewport: DESKTOP });

  test("the rail carries the page's only h1", async ({ page }) => {
    const h1 = page.locator("h1");
    await expect(h1).toHaveCount(1);
    await expect(page.locator(`${RAIL} h1`)).toHaveCount(1);
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
    const linkedin = page.locator(`${RAIL} a[href*="linkedin.com"]`);
    await expect(linkedin).toHaveAttribute("target", "_blank");

    const rel = await linkedin.getAttribute("rel");
    expect(rel).toContain("noopener");
    expect(rel).toContain("noreferrer");
    expect(rel).toContain("me");
  });
});

test.describe("reduced motion", () => {
  test.use({ viewport: DESKTOP, reducedMotion: "reduce" });

  test("content stays visible and the rail still pins", async ({ page }) => {
    await expect(page.locator(`${RAIL} h1`)).toBeVisible();
    await expect(page.locator(`${SCROLL} .about-block`).first()).toBeVisible();
    await expect(page.locator(RAIL_INNER)).toHaveCSS("position", "sticky");
  });
});
