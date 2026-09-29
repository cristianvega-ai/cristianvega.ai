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
  /** Below the 960px layout breakpoint. */
  tablet: { width: 900, height: 1000 },
  /** Below the 760px and 520px refinements. */
  mobile: { width: 390, height: 844 },
};

/**
 * Wait out any entrance animation in main before measuring.
 *
 * Geometry read while an animation is mid-flight is the animation's transform,
 * not the layout's. Resolves at once when nothing animates, as under reduced
 * motion.
 * A cancelled animation is not mid-flight, so its cancellation counts as done.
 */
export async function settle(page) {
  await page
    .locator("main")
    .evaluate((el) =>
      Promise.all(el.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined))),
    );
}

/**
 * Set the reduced-motion preference for this page.
 *
 * Always use this. `test.use({ reducedMotion: "reduce" })` is a silent no-op in
 * this project — under Playwright 1.62.1 the option never reaches the context,
 * `matchMedia("(prefers-reduced-motion: reduce)").matches` stays false, and the
 * test runs with motion fully enabled while appearing to assert the opposite.
 * It fails open, so nothing warns you. `page.emulateMedia` works correctly.
 */
export async function useReducedMotion(page, reducedMotion = "reduce") {
  await page.emulateMedia({ reducedMotion });
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

/**
 * Locate a header link by its label. At 640px and below the links sit in a
 * menu, so this opens the menu first when its button is showing.
 * Returns the link locator. Call it again after each navigation.
 */
export function navLink(page, name) {
  const link = page.locator(".nav:visible, .nav-menu:visible").getByRole("link", { name, exact: true });
  return {
    async click() {
      const toggle = page.locator(".nav-menu__toggle:visible");
      if (await toggle.count()) await toggle.click();
      await link.click();
    },
  };
}
