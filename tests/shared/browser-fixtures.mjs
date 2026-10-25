import { expect, test as browserTest } from "@playwright/test";
import { spawn } from "node:child_process";
import { cp as copyFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { createContentBuild, publishedContent, readContentInventory, root as projectRoot } from "./node-helpers.mjs";

export const currentContent = readContentInventory();
export const currentPublished = publishedContent(currentContent);

/**
 * Serve an isolated build through the same local Cloudflare runtime.
 * Return its origin and a function that stops the server.
 */
async function serveBuild(buildFixture) {
  let server;
  let serverClosed;
  const stop = async () => {
    if (server && server.exitCode === null) {
      server.kill("SIGTERM");
      const shutdownTimeout = setTimeout(() => server.kill("SIGKILL"), 5000);
      await serverClosed;
      clearTimeout(shutdownTimeout);
    }
  };
  try {
    await copyFile(join(projectRoot, "wrangler.jsonc"), join(buildFixture.root, "wrangler.jsonc"));
    const serverPort = await new Promise((resolve, reject) => {
      const portProbe = createServer();
      portProbe.once("error", reject);
      portProbe.listen(0, "127.0.0.1", () => {
        const serverAddress = portProbe.address();
        portProbe.close((error) => error ? reject(error) : resolve(serverAddress.port));
      });
    });
    const serverOrigin = `http://127.0.0.1:${serverPort}`;
    server = spawn(process.execPath, [join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js"),
      "dev", "--local", "--env", "test", "--port", String(serverPort), "--ip", "127.0.0.1",
      "--inspector-port", "0", "--show-interactive-dev-session", "false",
      "--persist-to", join(buildFixture.root, ".wrangler", "state")], {
      cwd: buildFixture.root,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    serverClosed = new Promise((resolve) => server.once("close", resolve));
    let serverOutput = "";
    const recordServerOutput = (outputChunk) => { serverOutput = `${serverOutput}${outputChunk}`.slice(-6000); };
    server.stdout.on("data", recordServerOutput);
    server.stderr.on("data", recordServerOutput);
    server.on("error", (error) => recordServerOutput(error.message));
    await expect.poll(async () => {
      if (server.exitCode !== null) throw new Error(`Publication runtime stopped: ${serverOutput}`);
      try {
        return (await fetch(serverOrigin, { signal: AbortSignal.timeout(1000) })).status;
      } catch {
        return 0;
      }
    }, { timeout: 60_000, message: "The publication runtime must serve the isolated build" }).toBe(200);
    return { origin: serverOrigin, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

export const publicationTest = browserTest.extend({
  publication: [async ({}, use) => {
    const publicationFixture = await createContentBuild("mixed");
    let runtime;
    try {
      runtime = await serveBuild(publicationFixture);
      await use({ ...publicationFixture, origin: runtime.origin });
    } finally {
      await runtime?.stop();
      await publicationFixture.cleanup();
    }
  }, { scope: "worker", timeout: 90_000 }],
});

/**
 * Serve the repository content with the first Lab experiment published.
 * The build links the real media, so the clips, posters, and scenes load as in production.
 */
export const labTest = browserTest.extend({
  lab: [async ({}, use) => {
    const labFixture = await createContentBuild("mixed", { lab: { state: "published" } });
    let runtime;
    try {
      runtime = await serveBuild(labFixture);
      const experiment = labFixture.inventory.lab[0];
      await use({ ...labFixture, origin: runtime.origin, experiment, results: experiment.data.results });
    } finally {
      await runtime?.stop();
      await labFixture.cleanup();
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

/** The three widths where the reading column, the reading star, and the home sections change. */
export const VIEWPORTS = {
  /** Select the layout above the 900px breakpoint, where the reading star sits in the margin. */
  desktop: { width: 1440, height: 900 },
  /** Select the narrowest width that still has the margin star. Below it, the star is a pill. */
  tablet: { width: 900, height: 900 },
  /** Select the pill layout of the reading star on a phone. */
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

/**
 * Replace the page of each Lab scene with a small stub and keep the real response headers.
 * The scenes are real-time 3D apps that load the processor for as long as they run.
 * Use this helper in tests that check the way to a scene, not the scene itself.
 */
export async function stubSceneBodies(page) {
  const stubBody = "<!doctype html><title>Scene stub</title><p>Scene stub</p>";
  await page.route("**/lab/scenes/**", async (route) => {
    const response = await route.fetch();
    if (!(response.headers()["content-type"] ?? "").includes("text/html")) return route.fulfill({ response });
    return route.fulfill({ response, body: stubBody, headers: { ...response.headers(), "content-length": String(Buffer.byteLength(stubBody)) } });
  });
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
 * Find the parts of the reading star on a detail page.
 * The site has no header or menu, so the star is the only way up from a detail page.
 */
export function readingStar(page) {
  const star = page.locator("[data-reading-star]");
  return {
    star,
    link: star.locator(".reading-star__link"),
    label: star.locator(".reading-star__label"),
    mark: star.locator(".mark"),
    lines: star.locator(".mark__line"),
  };
}

/**
 * Replace requestAnimationFrame with a manual clock.
 * Run queued frames with `playFrames`.
 * Count queued frames with `pendingFrames`.
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

/** Dispatch pagehide or pageshow on the window. */
export const dispatchPageTransition = (page, transitionType, persisted = true) => page.evaluate(([transitionType, isPersisted]) => {
  window.dispatchEvent(new PageTransitionEvent(transitionType, { persisted: isPersisted }));
}, [transitionType, persisted]);

/** Check visible page content and horizontal overflow. */
export async function expectReadablePage(page) {
  await expect(page.locator("main h1")).toHaveCount(1);
  await expect(page.locator("main h1")).toBeVisible();
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(horizontalOverflow, `${page.url()}: page content must have no horizontal overflow beyond one pixel`).toBeLessThanOrEqual(1);
}
