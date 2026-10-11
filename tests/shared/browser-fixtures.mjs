import { expect, test as browserTest } from "@playwright/test";
import { spawn } from "node:child_process";
import { cp as copyFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { createContentBuild, latestWork, publishedContent, readContentInventory, root as projectRoot } from "./node-helpers.mjs";

export const currentContent = readContentInventory();
export const currentPublished = publishedContent(currentContent);
export { latestWork };

// Serve the isolated build through the same local Cloudflare runtime.
export const publicationTest = browserTest.extend({
  publication: [async ({}, use) => {
    const publicationFixture = await createContentBuild("mixed");
    let publicationServer;
    let serverClosed;
    try {
      await copyFile(join(projectRoot, "wrangler.jsonc"), join(publicationFixture.root, "wrangler.jsonc"));
      const serverPort = await new Promise((resolve, reject) => {
        const portProbe = createServer();
        portProbe.once("error", reject);
        portProbe.listen(0, "127.0.0.1", () => {
          const serverAddress = portProbe.address();
          portProbe.close((error) => error ? reject(error) : resolve(serverAddress.port));
        });
      });
      const publicationOrigin = `http://127.0.0.1:${serverPort}`;
      publicationServer = spawn(process.execPath, [join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js"),
        "dev", "--local", "--env", "test", "--port", String(serverPort), "--ip", "127.0.0.1",
        "--inspector-port", "0", "--show-interactive-dev-session", "false",
        "--persist-to", join(publicationFixture.root, ".wrangler", "state")], {
        cwd: publicationFixture.root,
        env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      serverClosed = new Promise((resolve) => publicationServer.once("close", resolve));
      let serverOutput = "";
      const recordServerOutput = (outputChunk) => { serverOutput = `${serverOutput}${outputChunk}`.slice(-6000); };
      publicationServer.stdout.on("data", recordServerOutput);
      publicationServer.stderr.on("data", recordServerOutput);
      publicationServer.on("error", (error) => recordServerOutput(error.message));
      await expect.poll(async () => {
        if (publicationServer.exitCode !== null) throw new Error(`Publication runtime stopped: ${serverOutput}`);
        try {
          return (await fetch(publicationOrigin, { signal: AbortSignal.timeout(1000) })).status;
        } catch {
          return 0;
        }
      }, { timeout: 60_000, message: "The publication runtime must serve the isolated build" }).toBe(200);
      await use({ ...publicationFixture, origin: publicationOrigin });
    } finally {
      if (publicationServer && publicationServer.exitCode === null) {
        publicationServer.kill("SIGTERM");
        const shutdownTimeout = setTimeout(() => publicationServer.kill("SIGKILL"), 5000);
        await serverClosed;
        clearTimeout(shutdownTimeout);
      }
      await publicationFixture.cleanup();
    }
  }, { scope: "worker", timeout: 90_000 }],
});

/**
 * Share browser helpers for computed layout and runtime behavior.
 * Keep page selectors in the suite that uses them.
 */

/** Playwright starts the development server at this origin to show drafts. */
export const DRAFT_ORIGIN = process.env.BROWSER_TEST_DRAFT_ORIGIN ?? "http://127.0.0.1:4324";

/**
 * Collect uncaught page errors and console messages of the supplied types.
 * Call this helper before navigation.
 * Read the returned errors at the end of the test.
 */
export function pageProblems(page, consoleTypes = ["error"]) {
  const recordedPageProblems = [];
  page.on("pageerror", (error) => recordedPageProblems.push(error.message));
  page.on("console", (message) => {
    if (consoleTypes.includes(message.type())) recordedPageProblems.push(message.text());
  });
  return recordedPageProblems;
}

/** Record content security policy violations before navigation. */
export const recordContentSecurityPolicyViolations = (page) =>
  page.addInitScript(() => {
    window.__contentSecurityPolicyViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => window.__contentSecurityPolicyViolations.push(event.violatedDirective));
  });

/** Read the content security policy directives that the page violated. */
export const contentSecurityPolicyViolations = (page) => page.evaluate(() => window.__contentSecurityPolicyViolations);

/** Read the accessibility state of a decorative canvas. */
const readDecorativeState = (page, selector) =>
  page.evaluate((graphicSelector) => {
    const graphicRoot = document.querySelector(graphicSelector);
    return {
      accessibilityHidden: graphicRoot.getAttribute("aria-hidden"),
      pointerEvents: [graphicRoot, graphicRoot.querySelector("canvas")].map((graphicElement) => getComputedStyle(graphicElement).pointerEvents),
      canvasCount: graphicRoot.querySelectorAll("canvas").length,
      focusableControlCount: graphicRoot.querySelectorAll("a, button, input, select, textarea, [tabindex]").length,
    };
  }, selector);

/** Desktop and mobile select distinct navigation and graphic layouts. */
export const VIEWPORTS = {
  /** Select the desktop layout above all responsive breakpoints. */
  desktop: { width: 1440, height: 900 },
  /** Select the mobile layout below the 760px and 520px breakpoints. */
  mobile: { width: 390, height: 844 },
};

/**
 * Wait for main content entrance animations and web fonts before measuring layout.
 * Active animation transforms and fallback fonts can change measured geometry.
 * Treat cancelled animations as complete.
 */
export async function settle(page) {
  await page
    .locator("main")
    .evaluate(async (element) => {
      await Promise.all([...document.fonts].map((fontFace) => fontFace.load().catch(() => undefined)));
      await document.fonts.ready;
      await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)));
    });
}

/**
 * Set the reduced motion preference before navigation or during a running scene.
 * Use `test.use({ reducedMotion: "reduce" })` for a fixed Playwright preference.
 */
export async function useReducedMotion(page, reducedMotion = "reduce") {
  await page.emulateMedia({ reducedMotion });
}

/** Press Tab until the target has keyboard focus and can match :focus-visible. */
export async function tabTo(page, selector, maximumAttempts = 25) {
  const focusTarget = page.locator(selector);

  for (let focusAttempt = 0; focusAttempt < maximumAttempts; focusAttempt += 1) {
    await page.keyboard.press("Tab");
    if (await focusTarget.evaluate((element) => element === document.activeElement)) return true;
  }

  return false;
}

/**
 * Click a header link by its label.
 * Open the navigation menu first when its toggle is visible.
 * Get a new link helper after each navigation.
 */
export function navigationLink(page, linkName) {
  const link = page.locator(".navigation:visible, .navigation-menu:visible").getByRole("link", { name: linkName, exact: true });
  return {
    async click() {
      const menuToggle = page.locator(".navigation-menu__toggle:visible");
      if (await menuToggle.count()) await menuToggle.click();
      await link.click();
    },
  };
}

/**
 * Replace requestAnimationFrame with a manual clock.
 * Run queued frames with `window.__step(time)`.
 * Count queued frames with `window.__pending()`.
 */
export async function useManualFrames(page) {
  await page.addInitScript(() => {
    let nextFrameIdentifier = 0;
    const frameCallbacks = new Map();
    window.requestAnimationFrame = (frameCallback) => {
      nextFrameIdentifier += 1;
      frameCallbacks.set(nextFrameIdentifier, frameCallback);
      return nextFrameIdentifier;
    };
    window.cancelAnimationFrame = (frameIdentifier) => {
      frameCallbacks.delete(frameIdentifier);
    };
    window.__pending = () => frameCallbacks.size;
    window.__step = (frameTime) => {
      const pendingCallbacks = [...frameCallbacks.values()];
      frameCallbacks.clear();
      for (const frameCallback of pendingCallbacks) frameCallback(frameTime);
    };
  });
}

/** Run one manual frame at the supplied time. */
export const stepFrame = (page, frameTime) => page.evaluate((frameTime) => window.__step(frameTime), frameTime);

/** Count the queued manual frames. */
export const pendingFrames = (page) => page.evaluate(() => window.__pending());

/** Advance the manual clock in 16 ms frames. */
export const playFrames = (page, durationMilliseconds) =>
  page.evaluate((durationMilliseconds) => {
    window.__time = window.__time ?? 0;
    for (let endTime = window.__time + durationMilliseconds; window.__time < endTime; ) {
      window.__time += 16;
      window.__step(window.__time);
    }
  }, durationMilliseconds);

/** Count canvas pixels above the supplied alpha threshold. */
export const paintedPixels = (page, graphicSelector, minimumAlpha) =>
  page.locator(`${graphicSelector} canvas`).evaluate((canvas, minimumAlpha) => {
    const { data: pixelData } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
    let paintedPixelCount = 0;
    for (let alphaIndex = 3; alphaIndex < pixelData.length; alphaIndex += 4) if (pixelData[alphaIndex] > minimumAlpha) paintedPixelCount += 1;
    return paintedPixelCount;
  }, minimumAlpha);

/** Open a page and wait for its graphic. */
export async function openGraphic(page, graphicTarget) {
  await page.goto(graphicTarget.address);
  await expect(page.locator(graphicTarget.graphic)).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
}

/** Read the visible text boxes in main. */
async function readVisibleTextRectangles(page) {
  return page.evaluate(() => {
    const textRectangles = [];
    const textWalker = document.createTreeWalker(document.querySelector("main"), NodeFilter.SHOW_TEXT);
    for (let textNode = textWalker.nextNode(); textNode; textNode = textWalker.nextNode()) {
      if (!textNode.textContent.trim()) continue;
      const textRange = document.createRange();
      textRange.selectNodeContents(textNode);
      for (const rectangle of textRange.getClientRects()) {
        if (rectangle.width > 0 && rectangle.bottom > 0 && rectangle.top < innerHeight) {
          textRectangles.push({ x: rectangle.left, y: rectangle.top, width: rectangle.width, height: rectangle.height });
        }
      }
    }
    return textRectangles;
  });
}

/**
 * Record drawn labels and font measurements before navigation.
 * Read the latest label boxes with `drawnLabels`.
 */
export async function useLabelSpy(page) {
  await page.addInitScript(() => {
    const canvasPrototype = CanvasRenderingContext2D.prototype;
    const originalFillText = canvasPrototype.fillText;
    const originalMeasureText = canvasPrototype.measureText;
    window.__labels = new Map();
    window.__labelMeasureCount = 0;
    const canvasIdentifiers = new WeakMap();
    let canvasIdentifier = 0;
    canvasPrototype.measureText = function (...measurementArguments) {
      window.__labelMeasureCount += 1;
      return originalMeasureText.apply(this, measurementArguments);
    };
    canvasPrototype.fillText = function (text, x, y, ...textArguments) {
      const transform = this.getTransform();
      if (!canvasIdentifiers.has(this.canvas)) canvasIdentifiers.set(this.canvas, ++canvasIdentifier);
      const labelKey = `${text}@${canvasIdentifiers.get(this.canvas)}`;
      window.__labels.set(labelKey, {
        text,
        x: x + transform.e / transform.a,
        y: y + transform.f / transform.d,
        align: this.textAlign,
        font: this.font,
        width: originalMeasureText.call(this, text).width,
        canvas: this.canvas,
      });
      return originalFillText.call(this, text, x, y, ...textArguments);
    };
  });
}

/** Read drawn label boxes in canvas pixels. */
export async function drawnLabels(page) {
  return page.evaluate(() => {
    const labelBoxes = [...window.__labels.values()].map((label) => {
      const canvasRectangle = label.canvas.getBoundingClientRect();
      const labelLeft = label.align === "left" ? label.x : label.align === "right" ? label.x - label.width : label.x - label.width / 2;
      return {
        text: label.text,
        font: label.font,
        localLeft: labelLeft,
        localRight: labelLeft + label.width,
        localTop: label.y - 6,
        localBottom: label.y + 6,
        canvasWidth: canvasRectangle.width,
        canvasHeight: canvasRectangle.height,
      };
    });
    return { labels: labelBoxes };
  });
}

/**
 * Read the focus ring bounds and footer fade position in page pixels.
 * Use the nearest ancestor with an outline when the focused element has none.
 */
export async function focusRingAndFade(page) {
  return page.evaluate(() => {
    let element = document.activeElement;
    while (element && getComputedStyle(element).outlineStyle === "none") element = element.parentElement;
    const focusStyle = getComputedStyle(element);
    const focusedRectangle = element.getBoundingClientRect();
    const footerRectangle = document.querySelector(".site-footer").getBoundingClientRect();
    const footerFadeHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--footer-fade")) || 0;
    return {
      ringTop: focusedRectangle.top - parseFloat(focusStyle.outlineOffset) - parseFloat(focusStyle.outlineWidth),
      ringBottom: focusedRectangle.bottom + parseFloat(focusStyle.outlineOffset) + parseFloat(focusStyle.outlineWidth),
      fadeTop: footerRectangle.top - footerFadeHeight,
    };
  });
}


/** Check visible page content and horizontal overflow. */
export async function expectReadablePage(page) {
  await expect(page.locator("main h1")).toHaveCount(1);
  await expect(page.locator("main h1")).toBeVisible();
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(horizontalOverflow, `${page.url()}: page content must have no horizontal overflow beyond one pixel`).toBeLessThanOrEqual(1);
}

/** Check foreground paint and decorative accessibility. */
export async function expectDecorativeGraphic(page, selector) {
  const accessibilityState = await readDecorativeState(page, selector);
  expect(accessibilityState.accessibilityHidden, `${selector}: the graphic must stay hidden from accessibility tools`).toBe("true");
  expect(accessibilityState.pointerEvents, `${selector}: the graphic must ignore pointer input`).toEqual(["none", "none"]);
  expect(accessibilityState.focusableControlCount, `${selector}: the graphic must contain no focusable controls`).toBe(0);
  expect(accessibilityState.canvasCount, `${selector}: the graphic must contain one canvas`).toBe(1);
  const graphicRectangle = await page.locator(selector).boundingBox();
  expect(graphicRectangle.width, `${selector}: the graphic width must exceed 100 pixels`).toBeGreaterThan(100);
  expect(graphicRectangle.height, `${selector}: the graphic height must exceed 100 pixels`).toBeGreaterThan(100);
  expect(await paintedPixels(page, selector, 8), `${selector}: the scene must draw more than 100 foreground pixels`).toBeGreaterThan(100);
}

/** Check that foreground canvas paint cannot hide visible page text. */
export async function expectGraphicClearOfText(page, selector) {
  const textRectangles = await readVisibleTextRectangles(page);
  expect(textRectangles.length, `${page.url()}: the paint overlap check must receive visible text`).toBeGreaterThan(0);
  const overlappingPixelCount = await page.locator(`${selector} canvas`).evaluate((canvas, textRectangles) => {
    const rectangle = canvas.getBoundingClientRect();
    const bitmapScale = canvas.width / rectangle.width;
    const drawingContext = canvas.getContext("2d");
    let paintedPixelCount = 0;
    for (const textRectangle of textRectangles) {
      const pixelLeft = Math.max(0, Math.floor((textRectangle.x - rectangle.left) * bitmapScale));
      const top = Math.max(0, Math.floor((textRectangle.y - rectangle.top) * bitmapScale));
      const right = Math.min(canvas.width, Math.ceil((textRectangle.x + textRectangle.width - rectangle.left) * bitmapScale));
      const bottom = Math.min(canvas.height, Math.ceil((textRectangle.y + textRectangle.height - rectangle.top) * bitmapScale));
      if (right <= pixelLeft || bottom <= top) continue;
      const { data: pixelData } = drawingContext.getImageData(pixelLeft, top, right - pixelLeft, bottom - top);
      for (let alphaIndex = 3; alphaIndex < pixelData.length; alphaIndex += 4) if (pixelData[alphaIndex] > 8) paintedPixelCount += 1;
    }
    return paintedPixelCount;
  }, textRectangles);
  expect(overlappingPixelCount, `${selector}: foreground paint must have no overlap with visible page text`).toBe(0);
}
