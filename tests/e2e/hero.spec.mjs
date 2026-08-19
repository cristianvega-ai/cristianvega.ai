import { expect, test } from "@playwright/test";

import { tabTo, VIEWPORTS } from "./fixtures.mjs";

/**
 * The hero entrance is a runtime contract: an animation clock, a sessionStorage
 * replay mode, a webfont race, and a pre-paint gate that hides the real copy
 * until the motion takes over. All of it is behavior, not markup, so none of it
 * is reachable from the Node contract tests in tests/*.test.mjs.
 *
 * Each spec asserts what the browser does. The one thing this file controls is
 * the network: `beforeEach` serves the webfont stylesheet locally, because the
 * full entrance is gated on `document.fonts.ready` behind a 1.2s deadline. A
 * slow or offline network would quietly select the fallback path and make every
 * timing assertion flake.
 */

const { desktop: DESKTOP, tablet: TABLET, mobile: MOBILE } = VIEWPORTS;

const HERO = ".hero";
const COPY_CANVAS = ".hero__copy-canvas";
const MOTION_LAYER = "[data-hero-motion]";
const PENDING = "data-hero-motion-pending";
const SESSION_KEY = "cristianvega:hero-motion:v1";

/** The six hero lines the entrance hides and then hands back to the DOM. */
const TARGETS = ["eyebrow", "name", "highlight", "subhead", "primary-action", "secondary-action"];

/** Long enough for the full entrance plus the module failsafe, never longer. */
const SETTLE_TIMEOUT = 6000;

test.use({ viewport: DESKTOP });

test.beforeEach(async ({ page }) => {
  await page.route(/fonts\.googleapis\.com/, (route) =>
    route.fulfill({ status: 200, contentType: "text/css", body: "" }),
  );
  await page.route(/fonts\.gstatic\.com/, (route) => route.fulfill({ status: 200, body: "" }));
});

const hero = (page) => page.locator(HERO);
const target = (page, kind) => page.locator(`${HERO} [data-motion-target="${kind}"]`);
const sessionFlag = (page) => page.evaluate((key) => sessionStorage.getItem(key), SESSION_KEY);

/**
 * Timestamp every hero attribute change from before the first page script runs.
 * A run can then be measured from the marks instead of polled, so no spec needs
 * an arbitrary sleep. The init script runs again on each navigation, which
 * gives each document its own list.
 */
async function recordMotionMarks(page) {
  await page.addInitScript((pendingAttribute) => {
    const marks = [];
    window.__heroMarks = marks;

    new MutationObserver((records) => {
      const at = performance.now();
      for (const record of records) {
        marks.push({
          at,
          name: record.attributeName,
          value: record.target.getAttribute(record.attributeName),
        });
      }
    }).observe(document, {
      subtree: true,
      attributes: true,
      attributeFilter: [pendingAttribute, "data-motion-state", "data-motion-mode"],
    });
  }, PENDING);
}

const readMarks = (page) => page.evaluate(() => window.__heroMarks);

const markAt = (marks, name, value) =>
  marks.find((mark) => mark.name === name && mark.value === value)?.at ?? null;

/** Milliseconds between the entrance starting and the hero settling. */
function runLength(marks) {
  const started = markAt(marks, "data-motion-state", "playing");
  const ended = markAt(marks, "data-motion-state", "complete");
  expect(started, "the entrance must start").not.toBeNull();
  expect(ended, "the entrance must settle").not.toBeNull();
  return ended - started;
}

const pageClock = (page) => page.evaluate(() => performance.now());

/**
 * Milliseconds from a moment on the page clock to the hero settling. An
 * interrupt must settle the hero on the spot. Without this an interrupt that
 * did nothing would still pass, because the entrance ends on its own well
 * inside the assertion timeout.
 */
async function settleDelay(page, since) {
  const ended = markAt(await readMarks(page), "data-motion-state", "complete");
  expect(ended, "the hero must settle").not.toBeNull();
  return ended - since;
}

/**
 * How far the last hero button has formed on the frame before the hero
 * settles. Completion clears data-motion-mode, which drops the button's reveal
 * ramp. A button still climbing at that moment snaps to full in front of the
 * reader.
 */
function handoffReveal(page) {
  return page.evaluate(
    (limit) =>
      new Promise((resolve) => {
        const root = document.querySelector(".hero");
        const action = document.querySelector('[data-motion-target="secondary-action"]');
        const deadline = performance.now() + limit;
        let last = null;

        const sample = () => {
          if (root.dataset.motionState === "complete" || performance.now() > deadline) {
            resolve(last);
            return;
          }
          last = Number(getComputedStyle(action).getPropertyValue("--motion-reveal"));
          requestAnimationFrame(sample);
        };

        requestAnimationFrame(sample);
      }),
    SETTLE_TIMEOUT,
  );
}

/** Every hero line is on screen at full strength, and no canvas covers it. */
async function expectHeroReadable(page) {
  for (const kind of TARGETS) {
    await expect(target(page, kind)).toBeVisible();
    await expect(target(page, kind)).toHaveCSS("opacity", "1");
  }

  await expect(page.locator(COPY_CANVAS)).toHaveCSS("display", "none");
}

test.describe("the first visit plays the full entrance", () => {
  test("the run is in full mode and ends with every hero line readable", async ({ page }) => {
    await page.goto("/");

    // Pre-hide is on, so the copy starts hidden and the entrance owns it.
    await expect(page.locator("html")).toHaveAttribute(PENDING);
    await expect(hero(page)).toHaveAttribute("data-motion-mode", "full");
    await expect(hero(page)).toHaveAttribute("data-motion-state", "playing");
    await expect(target(page, "name")).toHaveCSS("opacity", "0");

    await expect(hero(page)).toHaveAttribute("data-motion-state", "complete", {
      timeout: SETTLE_TIMEOUT,
    });

    // Settled: the gate is released and the mode no longer drives any rule.
    await expect(page.locator("html")).not.toHaveAttribute(PENDING);
    await expect(hero(page)).not.toHaveAttribute("data-motion-mode");
    await expectHeroReadable(page);

    // The words themselves, not just the boxes that hold them.
    await expect(page.locator(".hero__name")).toHaveText("Cristian Vega");
    await expect(target(page, "subhead")).toHaveText(
      "I build agentic AI where mistakes are expensive, and lead the teams that ship it.",
    );

    // Only a finished run claims the session.
    expect(await sessionFlag(page)).toBe("1");
  });

  test("the last hero button has arrived when the clock stops", async ({ page }) => {
    await page.goto("/");
    await expect(hero(page)).toHaveAttribute("data-motion-mode", "full");

    const reveal = await handoffReveal(page);

    // The buttons form through --motion-reveal, and the last one owns the end of
    // the run. A window that outlasted the clock would snap it into place.
    expect(reveal).toBeGreaterThan(0.9);
  });

  test("the copy layer spans the whole hero grid while it plays", async ({ page }) => {
    await page.goto("/");
    await expect(hero(page)).toHaveAttribute("data-motion-mode", "full");

    const boxes = await page.evaluate(() => {
      const box = (selector) => {
        const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect();
        return { x, y, width, height };
      };
      return {
        grid: box(".hero__grid"),
        copy: box(".hero__copy-canvas"),
        main: box(".hero__main"),
      };
    });

    await expect(page.locator(COPY_CANVAS)).toHaveCSS("display", "block");

    // Particles travel out of the portrait region into the copy region. A layer
    // sized to the copy column alone would clip that journey at the seam.
    expect(Math.abs(boxes.copy.x - boxes.grid.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(boxes.copy.y - boxes.grid.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(boxes.copy.width - boxes.grid.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(boxes.copy.height - boxes.grid.height)).toBeLessThanOrEqual(1);
    expect(boxes.copy.width).toBeGreaterThan(boxes.main.width);
  });

  test("a full run keeps the console clean", async ({ page }) => {
    const problems = [];
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(message.text());
    });
    page.on("pageerror", (error) => problems.push(String(error)));

    await page.goto("/");
    await expect(hero(page)).toHaveAttribute("data-motion-state", "complete", {
      timeout: SETTLE_TIMEOUT,
    });

    expect(problems).toEqual([]);
  });
});

test.describe("a later visit in the same session", () => {
  test("a finished visit replays quick on the next load and settles far sooner", async ({
    page,
  }) => {
    await recordMotionMarks(page);
    await page.goto("/");
    await expect(hero(page)).toHaveAttribute("data-motion-state", "complete", {
      timeout: SETTLE_TIMEOUT,
    });
    expect(await sessionFlag(page)).toBe("1");
    const full = runLength(await readMarks(page));

    await page.reload();

    // The head stamp and the motion module must agree on the session key. If
    // they did not, this load would pre-hide the copy and replay in full.
    await expect(hero(page)).toHaveAttribute("data-motion-mode", "quick");
    await expect(hero(page)).toHaveAttribute("data-motion-state", "complete", { timeout: 2000 });

    const marks = await readMarks(page);
    expect(marks.some((mark) => mark.name === PENDING)).toBe(false);
    expect(runLength(marks)).toBeLessThan(full / 4);
    await expectHeroReadable(page);
  });

  test("arriving from another page runs the entrance again", async ({ page }) => {
    await page.goto("/about/");

    // The router swaps the document without a reload, so the entrance depends on
    // the astro:page-load hook rather than on the page's own first parse.
    await page.locator('header a.brand[href="/"]').click();
    await page.waitForURL("**/");

    await expect(hero(page)).toHaveAttribute("data-motion-mode", "full");
    await expect(hero(page)).toHaveAttribute("data-motion-state", "complete", {
      timeout: SETTLE_TIMEOUT,
    });
    await expectHeroReadable(page);
  });
});

test.describe("the session flag records only a finished play", () => {
  test("focus on a hero link reveals the copy and claims no play", async ({ page }) => {
    await recordMotionMarks(page);
    await page.goto("/");
    await expect(hero(page)).toHaveAttribute("data-motion-state", "playing");

    // A keyboard user who reaches the buttons must not have to wait for them.
    const interruptedAt = await pageClock(page);
    await target(page, "primary-action").focus();

    await expect(hero(page)).toHaveAttribute("data-motion-state", "complete");
    await expect(hero(page)).not.toHaveAttribute("data-motion-mode");
    await expectHeroReadable(page);
    expect(await settleDelay(page, interruptedAt)).toBeLessThan(500);
    expect(await sessionFlag(page)).toBeNull();

    // No play was recorded, so the next load owes the visitor the full entrance.
    await page.goto("/");
    await expect(hero(page)).toHaveAttribute("data-motion-mode", "full");
  });

  test("a resize reveals the copy and claims no play", async ({ page }) => {
    await recordMotionMarks(page);
    await page.goto("/");
    await expect(hero(page)).toHaveAttribute("data-motion-state", "playing");

    // Particle positions are measured once, so a resize invalidates the run.
    const resizedAt = await pageClock(page);
    await page.setViewportSize(TABLET);

    await expect(hero(page)).toHaveAttribute("data-motion-state", "complete");
    await expect(hero(page)).not.toHaveAttribute("data-motion-mode");
    await expectHeroReadable(page);
    // Settled on the resize debounce, not by running to the end.
    expect(await settleDelay(page, resizedAt)).toBeLessThan(800);
    expect(await sessionFlag(page)).toBeNull();
  });

  test("a stalled animation clock reveals the copy and claims no play", async ({ page }) => {
    await recordMotionMarks(page);
    await page.addInitScript(() => {
      // The clock never ticks: frame callbacks are accepted and dropped.
      window.requestAnimationFrame = () => 1;
      window.cancelAnimationFrame = () => {};
    });

    await page.goto("/");

    // The run starts and hides the copy, then never advances a frame.
    await expect(hero(page)).toHaveAttribute("data-motion-mode", "full");
    await expect(target(page, "name")).toHaveCSS("opacity", "0");

    await expect(hero(page)).toHaveAttribute("data-motion-state", "complete", {
      timeout: SETTLE_TIMEOUT,
    });

    // Only the module clears the inline hiding styles, so readable copy proves
    // the failsafe ran rather than the head script's own pending timer.
    await expect(page.locator("html")).not.toHaveAttribute(PENDING);
    await expect(hero(page)).not.toHaveAttribute("data-motion-mode");
    await expectHeroReadable(page);
    expect(await sessionFlag(page)).toBeNull();
    expect(runLength(await readMarks(page))).toBeLessThan(4500);
  });
});

test.describe("the pre-hide gate never strands the hero copy", () => {
  test("a hero script that never loads pre-hides the copy and then reveals it", async ({
    page,
  }) => {
    let blocked = 0;
    await page.route(/HeroMotion.*\.js$/, (route) => {
      blocked += 1;
      return route.abort();
    });

    await page.goto("/");
    expect(blocked, "the hero module bundle must be the blocked request").toBeGreaterThan(0);

    // Nothing is left to run the entrance, so the gate holds the copy hidden.
    await expect(page.locator("html")).toHaveAttribute(PENDING);
    for (const kind of TARGETS) {
      await expect(target(page, kind)).toHaveCSS("opacity", "0");
    }

    // The head script's own timer releases the gate without any module help.
    await expect(page.locator("html")).not.toHaveAttribute(PENDING, { timeout: SETTLE_TIMEOUT });
    for (const kind of TARGETS) {
      await expect(target(page, kind)).toHaveCSS("opacity", "1");
    }
  });

  test("a stalled webfont reveals the copy without an entrance", async ({ page }) => {
    await recordMotionMarks(page);
    await page.addInitScript(() => {
      // Fonts that never report ready: glyph metrics would shift under the run.
      Object.defineProperty(document.fonts, "ready", {
        configurable: true,
        get: () => new Promise(() => {}),
      });
    });

    await page.goto("/");
    await expect(hero(page)).toHaveAttribute("data-motion-state", "complete", {
      timeout: SETTLE_TIMEOUT,
    });

    const marks = await readMarks(page);
    // The deadline drops the entrance instead of animating on wrong metrics.
    expect(markAt(marks, "data-motion-state", "playing")).toBeNull();
    expect(markAt(marks, "data-motion-state", "complete")).toBeLessThan(2000);

    await expect(page.locator("html")).not.toHaveAttribute(PENDING);
    await expectHeroReadable(page);
    expect(await sessionFlag(page)).toBeNull();
  });

  test("pages other than the homepage never stamp the pending flag", async ({ page }) => {
    await recordMotionMarks(page);

    for (const route of ["/about/", "/writing/"]) {
      await page.goto(route);
      await expect(page.locator(MOTION_LAYER)).toHaveCount(0);
      await expect(page.locator("html")).not.toHaveAttribute(PENDING);

      const marks = await readMarks(page);
      const stamped = marks.some((mark) => mark.name === PENDING);
      expect(stamped, `${route} must not pre-hide`).toBe(false);
    }
  });
});

/**
 * Both specs below set the preference with `page.emulateMedia`. The
 * `test.use({ reducedMotion })` fixture does not reach `matchMedia` here, and a
 * spec that silently runs unreduced would assert nothing.
 */
test.describe("reduced motion", () => {
  test("the hero is readable at once and no entrance runs", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await recordMotionMarks(page);
    await page.goto("/");

    await expect(hero(page)).toHaveAttribute("data-motion-state", "complete");
    await expect(hero(page)).not.toHaveAttribute("data-motion-mode");
    await expectHeroReadable(page);

    const marks = await readMarks(page);
    // The copy is never hidden, not even for one frame before paint.
    expect(marks.some((mark) => mark.name === PENDING)).toBe(false);
    expect(markAt(marks, "data-motion-state", "playing")).toBeNull();

    // Nothing played, so a visitor who turns motion back on is still owed one.
    expect(await sessionFlag(page)).toBeNull();
  });

  test("the preference set during the entrance stops the motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await recordMotionMarks(page);
    await page.goto("/");
    await expect(hero(page)).toHaveAttribute("data-motion-state", "playing");

    const changedAt = await pageClock(page);
    await page.emulateMedia({ reducedMotion: "reduce" });

    await expect(hero(page)).toHaveAttribute("data-motion-state", "complete");
    await expect(hero(page)).not.toHaveAttribute("data-motion-mode");
    await expect(page.locator("html")).not.toHaveAttribute(PENDING);
    await expectHeroReadable(page);
    // The preference is live: the run stops now, it does not play itself out.
    expect(await settleDelay(page, changedAt)).toBeLessThan(500);
    expect(await sessionFlag(page)).toBeNull();
  });
});

test.describe("without javascript", () => {
  test.use({ javaScriptEnabled: false });

  test("the hero copy stays readable", async ({ page }) => {
    await page.goto("/");

    // Pre-hide is stamped by a script, so no script means no hidden copy.
    await expect(page.locator("html")).not.toHaveAttribute(PENDING);
    await expect(page.locator(".hero__name")).toHaveText("Cristian Vega");
    await expect(target(page, "subhead")).toHaveText(
      "I build agentic AI where mistakes are expensive, and lead the teams that ship it.",
    );

    for (const kind of TARGETS) {
      await expect(target(page, kind)).toHaveCSS("opacity", "1");
    }
  });
});

test.describe("hero structure and decorative layers", () => {
  test("the homepage ships exactly one hero motion system", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator(MOTION_LAYER)).toHaveCount(1);
    await expect(page.locator(".hero__portrait-canvas")).toHaveCount(1);
    await expect(page.locator(COPY_CANVAS)).toHaveCount(1);
    // Two layers and no more: superseded canvases must not ship beside them.
    await expect(page.locator(`${HERO} canvas`)).toHaveCount(2);
    await expect(page.locator(".hero__dots-canvas")).toHaveCount(0);

    for (const kind of TARGETS) {
      await expect(target(page, kind)).toHaveCount(1);
    }

    // Live hooks are the mode, the state, and the reveal custom property.
    await expect(page.locator("[data-motion-active]")).toHaveCount(0);
  });

  test("the canvas layers take no pointer input and hold no focus", async ({ page }) => {
    await page.addInitScript((key) => sessionStorage.setItem(key, "1"), SESSION_KEY);
    await page.goto("/");
    await expect(hero(page)).toHaveAttribute("data-motion-state", "complete", { timeout: 2000 });

    await expect(page.locator(MOTION_LAYER)).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator(MOTION_LAYER)).toHaveCSS("pointer-events", "none");
    await expect(page.locator(".hero__portrait-canvas")).toHaveCSS("pointer-events", "none");
    await expect(page.locator(COPY_CANVAS)).toHaveCSS("pointer-events", "none");

    await expect(page.locator(`${MOTION_LAYER} a, ${MOTION_LAYER} [tabindex]`)).toHaveCount(0);

    // The decorative layer sits above the copy, so keyboard order must ignore it.
    expect(await tabTo(page, `${HERO} [data-motion-target="primary-action"]`)).toBe(true);
  });
});

test.describe("mobile width", () => {
  test.use({ viewport: MOBILE });

  test("the entrance settles and every hero line is readable", async ({ page }) => {
    await page.goto("/");

    // The stacked layout measures a different grid, so the run must be re-proved.
    await expect(hero(page)).toHaveAttribute("data-motion-state", "complete", {
      timeout: SETTLE_TIMEOUT,
    });
    await expect(page.locator("html")).not.toHaveAttribute(PENDING);
    await expectHeroReadable(page);
    await expect(page.locator(".hero__name")).toHaveText("Cristian Vega");
  });
});
