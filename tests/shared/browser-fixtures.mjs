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

/** Count live observers and controller listeners. Keep native observer delivery. */
export async function useLifetimeSpy(page) {
  await page.addInitScript(() => {
    const activeObservers = { resize: new Set(), intersection: new Set() };
    const controllerListeners = new Map(["visibilitychange", "pagehide", "pageshow", "preference"].map((entryName) => [entryName, new Set()]));
    window.__observers = { resize: [], intersection: [] };
    for (const [observerKind, observerClassName] of [["resize", "ResizeObserver"], ["intersection", "IntersectionObserver"]]) {
      const nativeObserver = window[observerClassName];
      window[observerClassName] = class extends nativeObserver {
        constructor(observerCallback) {
          super(observerCallback);
          window.__observers[observerKind].push({ observer: this, callback: observerCallback });
        }
        observe(...observationArguments) {
          super.observe(...observationArguments);
          activeObservers[observerKind].add(this);
          if (observerKind === "intersection" && window.__failIntersection) throw new Error("Observe failed");
        }
        disconnect() {
          super.disconnect();
          activeObservers[observerKind].delete(this);
        }
      };
    }
    const originalAddEventListener = EventTarget.prototype.addEventListener;
    const originalRemoveEventListener = EventTarget.prototype.removeEventListener;
    const listenerKey = (target, eventType) => {
      if (target === document && eventType === "visibilitychange") return eventType;
      if (target === window && (eventType === "pagehide" || eventType === "pageshow")) return eventType;
      if (target instanceof MediaQueryList && eventType === "change" && target.media.includes("prefers-reduced-motion")) return "preference";
    };
    EventTarget.prototype.addEventListener = function (eventType, listener, listenerOptions) {
      const entryName = listenerKey(this, eventType);
      if (entryName) controllerListeners.get(entryName).add(listener);
      return originalAddEventListener.call(this, eventType, listener, listenerOptions);
    };
    EventTarget.prototype.removeEventListener = function (eventType, listener, listenerOptions) {
      const entryName = listenerKey(this, eventType);
      if (entryName) controllerListeners.get(entryName).delete(listener);
      return originalRemoveEventListener.call(this, eventType, listener, listenerOptions);
    };
    window.__lifetimes = () => ({
      resize: activeObservers.resize.size,
      intersection: activeObservers.intersection.size,
      ...Object.fromEntries([...controllerListeners].map(([entryName, registeredListeners]) => [entryName, registeredListeners.size])),
    });
  });
}

/** Read the observer and listener counts that `useLifetimeSpy` records. */
export const readResourceCounts = (page) => page.evaluate(() => window.__lifetimes());

/** Expected controller resources for a running scene, a scene after pagehide, and a destroyed scene. */
export const activeResourceCounts = { resize: 1, intersection: 1, visibilitychange: 1, pagehide: 1, pageshow: 1, preference: 1 };
export const pausedResourceCounts = { ...activeResourceCounts, resize: 0, intersection: 0, visibilitychange: 0, preference: 0 };
export const emptyResourceCounts = { resize: 0, intersection: 0, visibilitychange: 0, pagehide: 0, pageshow: 0, preference: 0 };

/** Mount a small scene through the real controller. Read its public handle. */
export async function mountScene(page, canvasPolicy, { duration: entranceDuration = 2300, busy: sceneBusy = false, count: sceneCount = 1 } = {}) {
  await useManualFrames(page);
  await useLifetimeSpy(page);
  const sceneAddress = `${DRAFT_ORIGIN}/__canvas-controller__/`;
  await page.route(sceneAddress, (route) => route.fulfill({
    contentType: "text/html",
    body: "<!doctype html><html><head><title>Canvas controller test</title></head><body></body></html>",
  }));
  await page.goto(sceneAddress);
  await page.evaluate(async (sceneSettings) => {
    const { mountCanvas } = await import("/src/shared/page-graphics/mount.ts");
    const { GLOBE_POLICY: globePolicy, mountCanvasController } = await import("/src/shared/canvas/canvas-controller.ts");
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, get: () => 3 });
    window.__busy = sceneSettings.busy;
    window.__draws = 0;
    window.__builds = 0;
    window.__attached = 0;
    window.__detached = 0;
    window.__handles = [];
    window.__stateChanged = false;
    for (let sceneIndex = 0; sceneIndex < sceneSettings.count; sceneIndex += 1) {
      const sceneRoot = document.createElement("div");
      sceneRoot.dataset.scene = String(sceneIndex);
      sceneRoot.style.cssText = "width:240px;height:160px;margin:24px";
      sceneRoot.append(document.createElement("canvas"));
      sceneRoot.firstElementChild.style.cssText = "display:block;width:100%;height:100%";
      document.body.append(sceneRoot);
      let initialDrawState;
      const canvasOptions = {
        duration: sceneSettings.duration,
        onResize() {
          window.__builds += 1;
        },
        draw(drawingContext, drawState) {
          if (initialDrawState && initialDrawState !== drawState) window.__stateChanged = true;
          initialDrawState = drawState;
          window.__draws += 1;
          drawingContext.drawImage(drawState.glow, 10, 10);
          drawingContext.fillRect(0, 0, drawState.progress * drawState.width, 1);
          return window.__busy && !drawState.reduced;
        },
        attach(controllerHandle) {
          window.__attached += 1;
          const wakeScene = () => controllerHandle.wake();
          window.addEventListener("scenechange", wakeScene);
          return () => {
            window.__detached += 1;
            window.removeEventListener("scenechange", wakeScene);
          };
        },
      };
      const controllerHandle = sceneSettings.policy === "page"
        ? mountCanvas(sceneRoot, canvasOptions)
        : mountCanvasController(sceneRoot, canvasOptions, globePolicy);
      window.__handles.push(controllerHandle);
    }
    window.__handle = window.__handles[0];
    const scrollSpacer = document.createElement("div");
    scrollSpacer.style.height = "3000px";
    document.body.append(scrollSpacer);
  }, { policy: canvasPolicy, duration: entranceDuration, busy: sceneBusy, count: sceneCount });
  await expect(page.locator("[data-scene][data-ready='true']")).toHaveCount(sceneCount);
  await expect.poll(() => pendingFrames(page)).toBe(sceneCount);
}

/** Read the clock state of the first scene that `mountScene` mounts. */
export const readControllerClock = (page) => page.evaluate(() => {
  const { elapsed, activeTime, reduced, ratio: pixelRatio } = window.__handle.state;
  return { elapsed, activeTime, reduced, ratio: pixelRatio };
});

/** Dispatch pagehide or pageshow on the window. */
export const dispatchPageTransition = (page, transitionType, persisted = true) => page.evaluate(([transitionType, isPersisted]) => {
  window.dispatchEvent(new PageTransitionEvent(transitionType, { persisted: isPersisted }));
}, [transitionType, persisted]);

/** Defer reduced motion events until the test releases them. */
export async function useDeferredPreference(page) {
  await page.addInitScript(() => {
    const originalAddEventListener = MediaQueryList.prototype.addEventListener;
    const originalRemoveEventListener = MediaQueryList.prototype.removeEventListener;
    const listenerWrappers = new WeakMap();
    window.__preferenceJobs = [];
    MediaQueryList.prototype.addEventListener = function (eventType, listener, listenerOptions) {
      if (eventType !== "change" || !this.media.includes("prefers-reduced-motion")) return originalAddEventListener.call(this, eventType, listener, listenerOptions);
      const deferredListener = (event) => window.__preferenceJobs.push(() => listener.call(this, event));
      listenerWrappers.set(listener, deferredListener);
      return originalAddEventListener.call(this, eventType, deferredListener, listenerOptions);
    };
    MediaQueryList.prototype.removeEventListener = function (eventType, listener, listenerOptions) {
      return originalRemoveEventListener.call(this, eventType, listenerWrappers.get(listener) ?? listener, listenerOptions);
    };
  });
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
