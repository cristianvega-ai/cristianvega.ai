/**
 * Shared helpers for the browser suite.
 *
 * Specs assert computed layout and runtime behavior — things absent from the
 * built HTML and therefore unreachable from the Node contract tests. Anything
 * here is page-agnostic; page-specific selectors belong in the spec that uses
 * them.
 */

/** Widths and heights that each select a distinct branch of the design system. */
export const VIEWPORTS = {
  /** Comfortably above every breakpoint. */
  desktop: { width: 1440, height: 900 },
  /** Inside the (max-height: 880px) trim, the common laptop case. */
  desktopShort: { width: 1280, height: 720 },
  /** Short enough that height-keyed backstops must engage. */
  desktopTiny: { width: 1280, height: 560 },
  /** Below the 960px split collapse. */
  tablet: { width: 900, height: 1000 },
  /** Below the 760px and 520px refinements. */
  mobile: { width: 390, height: 844 },
};

/**
 * Wait out the per-page entrance animation before measuring.
 *
 * Every route runs one (`[data-page="about"] main` uses developUp, writing and
 * contact use riseIn), and geometry read while it is mid-flight is the
 * animation's transform, not the layout's. Resolves immediately under reduced
 * motion, where the animation never applies.
 */
export async function settle(page) {
  await page
    .locator("main")
    .evaluate((el) => Promise.all(el.getAnimations().map((animation) => animation.finished)));
}

/**
 * Turn on the reduced-motion preference for this page.
 *
 * Always use this. `test.use({ reducedMotion: "reduce" })` is a silent no-op in
 * this project — under Playwright 1.62.1 the option never reaches the context,
 * `matchMedia("(prefers-reduced-motion: reduce)").matches` stays false, and the
 * test runs with motion fully enabled while appearing to assert the opposite.
 * It fails open, so nothing warns you. `page.emulateMedia` works correctly.
 */
export async function useReducedMotion(page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
}

/** Viewport-relative top edge, which is what sticky behavior is defined in. */
export function viewportTop(page, selector) {
  return page.locator(selector).evaluate((el) => el.getBoundingClientRect().top);
}

/** Track count of a grid, read off the resolved template rather than the rule. */
export async function columnCount(page, selector) {
  const template = await page
    .locator(selector)
    .evaluate((el) => getComputedStyle(el).gridTemplateColumns);

  return template.split(/\s+/).filter(Boolean).length;
}

/**
 * The layout viewport, which a classic scrollbar narrows below the nominal
 * width. Full-bleed assertions must compare against this or they flap.
 */
export function layoutWidth(page) {
  return page.evaluate(() => document.documentElement.clientWidth);
}

/** Tab forward until the target holds focus, so :focus-visible genuinely applies. */
export async function tabTo(page, selector, limit = 25) {
  const target = page.locator(selector);

  for (let i = 0; i < limit; i += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((el) => el === document.activeElement)) return true;
  }

  return false;
}
