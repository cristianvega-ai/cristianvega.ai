import { expect, test as baseTest } from "@playwright/test";
import { spawn } from "node:child_process";
import { cp as copyFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { createContentBuild, latestWork, publishedContent, readContentInventory, root } from "../helpers.mjs";

export const currentContent = readContentInventory();
export const currentPublished = publishedContent(currentContent);
export { latestWork };

// Serve the isolated build through the same local Cloudflare runtime.
export const publicationTest = baseTest.extend({
  publication: [async ({}, use) => {
    const fixture = await createContentBuild("mixed");
    let server;
    let closed;
    try {
      await copyFile(join(root, "wrangler.jsonc"), join(fixture.root, "wrangler.jsonc"));
      const port = await new Promise((resolve, reject) => {
        const probe = createServer();
        probe.once("error", reject);
        probe.listen(0, "127.0.0.1", () => {
          const address = probe.address();
          probe.close((error) => error ? reject(error) : resolve(address.port));
        });
      });
      const origin = `http://127.0.0.1:${port}`;
      server = spawn(process.execPath, [join(root, "node_modules", "wrangler", "bin", "wrangler.js"),
        "dev", "--local", "--env", "test", "--port", String(port), "--ip", "127.0.0.1",
        "--inspector-port", "0", "--show-interactive-dev-session", "false",
        "--persist-to", join(fixture.root, ".wrangler", "state")], {
        cwd: fixture.root,
        env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      closed = new Promise((resolve) => server.once("close", resolve));
      let output = "";
      const record = (chunk) => { output = `${output}${chunk}`.slice(-6000); };
      server.stdout.on("data", record);
      server.stderr.on("data", record);
      server.on("error", (error) => record(error.message));
      await expect.poll(async () => {
        if (server.exitCode !== null) throw new Error(`Publication runtime stopped: ${output}`);
        try {
          return (await fetch(origin, { signal: AbortSignal.timeout(1000) })).status;
        } catch {
          return 0;
        }
      }, { timeout: 60_000, message: "publication runtime must serve the isolated build" }).toBe(200);
      await use({ ...fixture, origin });
    } finally {
      if (server && server.exitCode === null) {
        server.kill("SIGTERM");
        const timeout = setTimeout(() => server.kill("SIGKILL"), 5000);
        await closed;
        clearTimeout(timeout);
      }
      await fixture.cleanup();
    }
  }, { scope: "worker", timeout: 90_000 }],
});

/**
 * Shared helpers for the browser suite.
 *
 * Specs assert computed layout and runtime behavior — things absent from the
 * built HTML and therefore unreachable from the Node contract tests. Anything
 * here is page-agnostic; page-specific selectors belong in the spec that uses
 * them.
 */

/** The dev server that shows drafts. Playwright starts it on this port. */
export const DRAFT_ORIGIN = process.env.BROWSER_TEST_DRAFT_ORIGIN ?? "http://127.0.0.1:4324";

/**
 * Collect uncaught page errors and the console messages of the given types.
 * Call it before the page loads, and read the returned list at the end of the test.
 */
export function pageProblems(page, types = ["error"]) {
  const problems = [];
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("console", (message) => {
    if (types.includes(message.type())) problems.push(message.text());
  });
  return problems;
}

/** Record each CSP violation of the page. Call it before the page loads. */
export const recordContentSecurityPolicyViolations = (page) =>
  page.addInitScript(() => {
    window.__contentSecurityPolicyViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => window.__contentSecurityPolicyViolations.push(event.violatedDirective));
  });

/** The directives the page violated since `recordContentSecurityPolicyViolations`. */
export const contentSecurityPolicyViolations = (page) => page.evaluate(() => window.__contentSecurityPolicyViolations);

/** Read the accessibility state of a decorative canvas. */
const decorativeState = (page, selector) =>
  page.evaluate((graphicSelector) => {
    const root = document.querySelector(graphicSelector);
    return {
      hidden: root.getAttribute("aria-hidden"),
      pointerEvents: [root, root.querySelector("canvas")].map((part) => getComputedStyle(part).pointerEvents),
      canvases: root.querySelectorAll("canvas").length,
      focusable: root.querySelectorAll("a, button, input, select, textarea, [tabindex]").length,
    };
  }, selector);

/** Desktop and mobile select distinct navigation and graphic layouts. */
export const VIEWPORTS = {
  /** Comfortably above every breakpoint. */
  desktop: { width: 1440, height: 900 },
  /** Below the 760px and 520px refinements. */
  mobile: { width: 390, height: 844 },
};

/**
 * Wait out any entrance animation in main, and any web font, before measuring.
 *
 * Geometry read while an animation is mid-flight is the animation's transform,
 * not the layout's. Geometry read before the web fonts arrive is the fallback
 * font's, which is taller and wider. A slow runner shows that gap. Resolves at
 * once when nothing animates, as under reduced motion.
 *
 * A cancelled animation is not mid-flight, so its cancellation counts as done.
 */
export async function settle(page) {
  await page
    .locator("main")
    .evaluate(async (element) => {
      await Promise.all([...document.fonts].map((face) => face.load().catch(() => undefined)));
      await document.fonts.ready;
      await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)));
    });
}

/**
 * Set the reduced-motion preference for this page.
 *
 * Use this helper to change the preference before navigation or during a running scene.
 * Playwright also supports a fixed preference through `test.use({ reducedMotion: "reduce" })`.
 */
export async function useReducedMotion(page, reducedMotion = "reduce") {
  await page.emulateMedia({ reducedMotion });
}

/** Tab forward until the target holds focus, so :focus-visible genuinely applies. */
export async function tabTo(page, selector, limit = 25) {
  const target = page.locator(selector);

  for (let focusAttempt = 0; focusAttempt < limit; focusAttempt += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => element === document.activeElement)) return true;
  }

  return false;
}

/**
 * Locate a header link by its label. At 640px and below the links sit in a
 * menu, so this opens the menu first when its button is showing.
 * Returns the link locator. Call it again after each navigation.
 */
export function navigationLink(page, name) {
  const link = page.locator(".navigation:visible, .navigation-menu:visible").getByRole("link", { name, exact: true });
  return {
    async click() {
      const toggle = page.locator(".navigation-menu__toggle:visible");
      if (await toggle.count()) await toggle.click();
      await link.click();
    },
  };
}

/**
 * Replace requestAnimationFrame with a manual clock. A frame runs only when a
 * test calls `window.__step(time)`, so the entrance stays in flight until the
 * test says otherwise, and `window.__pending()` counts the frames left queued.
 */
export async function useManualFrames(page) {
  await page.addInitScript(() => {
    let next = 0;
    const queue = new Map();
    window.requestAnimationFrame = (callback) => {
      next += 1;
      queue.set(next, callback);
      return next;
    };
    window.cancelAnimationFrame = (frameIdentifier) => {
      queue.delete(frameIdentifier);
    };
    window.__pending = () => queue.size;
    window.__step = (time) => {
      const callbacks = [...queue.values()];
      queue.clear();
      for (const callback of callbacks) callback(time);
    };
  });
}

/** Run one manual frame at the supplied time. */
export const stepFrame = (page, time) => page.evaluate((value) => window.__step(value), time);

/** Count the queued manual frames. */
export const pendingFrames = (page) => page.evaluate(() => window.__pending());

/** Advance the manual clock in 16 ms frames. */
export const playFrames = (page, milliseconds) =>
  page.evaluate((span) => {
    window.__time = window.__time ?? 0;
    for (let end = window.__time + span; window.__time < end; ) {
      window.__time += 16;
      window.__step(window.__time);
    }
  }, milliseconds);

/** Count canvas pixels above the supplied alpha threshold. */
export const paintedPixels = (page, graphic, minimumAlpha) =>
  page.locator(`${graphic} canvas`).evaluate((canvas, threshold) => {
    const { data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let alphaIndex = 3; alphaIndex < data.length; alphaIndex += 4) if (data[alphaIndex] > threshold) count += 1;
    return count;
  }, minimumAlpha);

/** Open a page and wait for its graphic. */
export async function openGraphic(page, target) {
  await page.goto(target.address);
  await expect(page.locator(target.graphic)).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
}

/** Read the visible text boxes in main. */
async function textBoxes(page) {
  return page.evaluate(() => {
    const boxes = [];
    const walker = document.createTreeWalker(document.querySelector("main"), NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rectangle of range.getClientRects()) {
        if (rectangle.width > 0 && rectangle.bottom > 0 && rectangle.top < innerHeight) {
          boxes.push({ x: rectangle.left, y: rectangle.top, width: rectangle.width, height: rectangle.height });
        }
      }
    }
    return boxes;
  });
}

/**
 * Record drawn labels and font measurements before navigation.
 * Read the latest label boxes with `drawnLabels`.
 */
export async function useLabelSpy(page) {
  await page.addInitScript(() => {
    const canvasPrototype = CanvasRenderingContext2D.prototype;
    const fillText = canvasPrototype.fillText;
    const measureText = canvasPrototype.measureText;
    window.__labels = new Map();
    window.__labelMeasureCount = 0;
    const canvases = new WeakMap();
    let canvasIdentifier = 0;
    canvasPrototype.measureText = function (...measurementArguments) {
      window.__labelMeasureCount += 1;
      return measureText.apply(this, measurementArguments);
    };
    canvasPrototype.fillText = function (text, x, y, ...rest) {
      const transform = this.getTransform();
      if (!canvases.has(this.canvas)) canvases.set(this.canvas, ++canvasIdentifier);
      const key = `${text}@${canvases.get(this.canvas)}`;
      window.__labels.set(key, {
        text,
        x: x + transform.e / transform.a,
        y: y + transform.f / transform.d,
        align: this.textAlign,
        font: this.font,
        width: measureText.call(this, text).width,
        canvas: this.canvas,
      });
      return fillText.call(this, text, x, y, ...rest);
    };
  });
}

/** Read drawn label boxes in canvas pixels. */
export async function drawnLabels(page) {
  return page.evaluate(() => {
    const labels = [...window.__labels.values()].map((label) => {
      const box = label.canvas.getBoundingClientRect();
      const left = label.align === "left" ? label.x : label.align === "right" ? label.x - label.width : label.x - label.width / 2;
      return {
        text: label.text,
        font: label.font,
        localLeft: left,
        localRight: left + label.width,
        localTop: label.y - 6,
        localBottom: label.y + 6,
        canvasWidth: box.width,
        canvasHeight: box.height,
      };
    });
    return { labels };
  });
}

/**
 * The bottom of the focus ring of the focused element, and the top of the footer fade, in page pixels.
 * The ring belongs to the focused element or to the nearest ancestor that draws an outline, as on an article row.
 */
export async function focusRingAndFade(page) {
  return page.evaluate(() => {
    let element = document.activeElement;
    while (element && getComputedStyle(element).outlineStyle === "none") element = element.parentElement;
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    const footer = document.querySelector(".site-footer").getBoundingClientRect();
    const fade = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--footer-fade")) || 0;
    return {
      ringTop: box.top - parseFloat(style.outlineOffset) - parseFloat(style.outlineWidth),
      ringBottom: box.bottom + parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth),
      fadeTop: footer.top - fade,
    };
  });
}


/** Check visible page content and serious horizontal overflow. */
export async function expectReadablePage(page) {
  await expect(page.locator("main h1")).toHaveCount(1);
  await expect(page.locator("main h1")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${page.url()}: page content must not overflow sideways`).toBeLessThanOrEqual(1);
}

/** Check actual foreground drawing and decorative accessibility. */
export async function expectDecorativeGraphic(page, selector) {
  const state = await decorativeState(page, selector);
  expect(state.hidden, `${selector}: the graphic remains decorative`).toBe("true");
  expect(state.pointerEvents, `${selector}: the graphic must not take pointer input`).toEqual(["none", "none"]);
  expect(state.focusable, `${selector}: the graphic must not take keyboard focus`).toBe(0);
  expect(state.canvases, `${selector}: one canvas mounts`).toBe(1);
  const box = await page.locator(selector).boundingBox();
  expect(box.width, `${selector}: the graphic has a useful width`).toBeGreaterThan(100);
  expect(box.height, `${selector}: the graphic has a useful height`).toBeGreaterThan(100);
  expect(await paintedPixels(page, selector, 8), `${selector}: the scene must draw foreground paint`).toBeGreaterThan(100);
}

/** Check that foreground canvas paint cannot hide visible page text. */
export async function expectGraphicClearOfText(page, selector) {
  const boxes = await textBoxes(page);
  expect(boxes.length, `${page.url()}: the clipping check requires visible text`).toBeGreaterThan(0);
  const painted = await page.locator(`${selector} canvas`).evaluate((canvas, boxes) => {
    const rectangle = canvas.getBoundingClientRect();
    const scale = canvas.width / rectangle.width;
    const context = canvas.getContext("2d");
    let count = 0;
    for (const box of boxes) {
      const left = Math.max(0, Math.floor((box.x - rectangle.left) * scale));
      const top = Math.max(0, Math.floor((box.y - rectangle.top) * scale));
      const right = Math.min(canvas.width, Math.ceil((box.x + box.width - rectangle.left) * scale));
      const bottom = Math.min(canvas.height, Math.ceil((box.y + box.height - rectangle.top) * scale));
      if (right <= left || bottom <= top) continue;
      const { data } = context.getImageData(left, top, right - left, bottom - top);
      for (let index = 3; index < data.length; index += 4) if (data[index] > 8) count += 1;
    }
    return count;
  }, boxes);
  expect(painted, `${selector}: foreground paint must not cover page text`).toBe(0);
}
