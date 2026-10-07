import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { root } from "../helpers.mjs";
import { settle, useManualFrames, useReducedMotion, VIEWPORTS, pendingFrames, stepFrame } from "./fixtures.mjs";

const globe = "[data-lyra-globe]";
const labels = `${globe} .lyra-globe__label`;
const problems = new WeakMap();
const opacity = (page) => page.locator(labels).evaluateAll((nodes) => nodes.map((node) => Number(getComputedStyle(node).opacity)));
const transition = (page, type) => page.evaluate((name) => {
  window.dispatchEvent(new PageTransitionEvent(name, { persisted: true }));
}, type);

test.use({ viewport: VIEWPORTS.desktop });

test.beforeEach(async ({ page }) => {
  const errors = [];
  problems.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
});

test.afterEach(async ({ page }) => {
  expect(problems.get(page), "the browser must report no console or CSP errors").toEqual([]);
});

async function finishLabels(page) {
  await expect(page.locator(globe)).toHaveAttribute("data-motion-state", "still");
  expect(await opacity(page)).toEqual([0.9, 0.7]);
  await expect.poll(() => page.locator(labels).evaluateAll((nodes) => nodes.flatMap((node) => node.getAnimations()).length)).toBe(0);
  await settle(page);
  expect(await page.locator(`${globe} [style]`).count()).toBe(0);
}

for (const pause of ["hidden", "offscreen"]) {
  test(`keeps label progress while the globe is ${pause}`, async ({ page }) => {
    await useManualFrames(page);
    await useReducedMotion(page, "no-preference");
    await page.goto("/");
    await expect(page.locator(globe)).toHaveAttribute("data-ready", "true");
    await expect.poll(() => pendingFrames(page)).toBe(1);
    await stepFrame(page, 1000);
    await stepFrame(page, 1800);
    await expect.poll(async () => (await opacity(page))[1]).toBeGreaterThan(0);
    const first = await opacity(page);
    expect(first[0]).toBe(0);
    expect(first[1]).toBeGreaterThan(0);
    expect(first[1]).toBeLessThan(0.7);

    const pauseTime = await page.evaluate((kind) => {
      if (kind === "hidden") {
        Object.defineProperty(document, "hidden", { configurable: true, value: true });
        document.dispatchEvent(new Event("visibilitychange"));
      } else {
        const spacer = document.createElement("div");
        for (let i = 0; i < 180; i++) spacer.append(document.createElement("br"));
        document.querySelector("#main-content").after(spacer);
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
      }
      return document.timeline.currentTime;
    }, pause);
    await expect.poll(() => pendingFrames(page)).toBe(0);
    const image = await page.locator(`${globe} canvas`).evaluate((canvas) => canvas.toDataURL());
    // Let the browser's animation clock pass the old label entrance.
    await expect.poll(() => page.evaluate((start) => document.timeline.currentTime - start, pauseTime), { timeout: 5000 }).toBeGreaterThan(2400);
    expect(await opacity(page)).toEqual(first);
    expect(await page.locator(`${globe} canvas`).evaluate((canvas) => canvas.toDataURL())).toBe(image);
    await expect(page.locator(globe)).toHaveAttribute("data-motion-state", "playing");

    await page.evaluate((kind) => {
      if (kind === "hidden") {
        Object.defineProperty(document, "hidden", { configurable: true, value: false });
        document.dispatchEvent(new Event("visibilitychange"));
      } else window.scrollTo({ top: 0, behavior: "instant" });
    }, pause);
    await expect.poll(() => pendingFrames(page)).toBe(1);
    await stepFrame(page, 10000);
    expect(await opacity(page)).toEqual(first);
    await stepFrame(page, 10500);
    expect(await opacity(page)).toEqual([0, 0.7]);
    await stepFrame(page, 11500);
    await finishLabels(page);
    expect(await pendingFrames(page)).toBe(0);
  });
}

test("shows complete labels for reduced motion and live preference changes", async ({ page }) => {
  await useManualFrames(page);
  await useReducedMotion(page);
  await page.goto("/");
  await finishLabels(page);
  expect(await pendingFrames(page)).toBe(0);
  await useReducedMotion(page, "no-preference");
  await finishLabels(page);
  await transition(page, "pagehide");
  await transition(page, "pageshow");
  await expect(page.locator(globe)).toHaveAttribute("data-ready", "true");
  await expect.poll(() => pendingFrames(page)).toBe(1);
  expect(await opacity(page)).toEqual([0, 0]);
  await stepFrame(page, 1);
  await stepFrame(page, 801);
  await useReducedMotion(page);
  await finishLabels(page);
  expect(await pendingFrames(page)).toBe(0);
});

test("restarts label progress after each restored entrance", async ({ page }) => {
  await useManualFrames(page);
  await useReducedMotion(page, "no-preference");
  await page.goto("/");
  for (let cycle = 0; cycle < 3; cycle++) {
    await expect(page.locator(globe)).toHaveAttribute("data-ready", "true");
    await expect.poll(() => pendingFrames(page)).toBe(1);
    expect(await opacity(page)).toEqual([0, 0]);
    expect(await page.locator(labels).evaluateAll((nodes) => nodes.flatMap((node) => node.getAnimations()).length)).toBe(2);
    await stepFrame(page, cycle * 10000 + 1);
    await stepFrame(page, cycle * 10000 + 2301);
    await finishLabels(page);
    await transition(page, "pagehide");
    await expect(page.locator(globe)).not.toHaveAttribute("data-ready", /.*/);
    expect(await pendingFrames(page)).toBe(0);
    await transition(page, "pageshow");
  }
});

test("shows complete fallback labels after a restored canvas fails", async ({ page }) => {
  await useManualFrames(page);
  await page.addInitScript(() => {
    const Observer = window.ResizeObserver;
    window.ResizeObserver = class extends Observer {
      constructor(callback) {
        if (window.__failResize) throw new Error("Resize setup failed");
        super(callback);
      }
    };
  });
  await page.goto("/");
  await expect(page.locator(globe)).toHaveAttribute("data-ready", "true");
  await stepFrame(page, 1);
  await stepFrame(page, 801);
  await transition(page, "pagehide");
  await page.evaluate(() => { window.__failResize = true; });
  await transition(page, "pageshow");
  await expect(page.locator(`${globe} .lyra-globe__fallback`)).toBeVisible();
  await expect(page.locator(`${globe} .lyra-globe__labels`)).toHaveCSS("opacity", "1");
  expect(await opacity(page)).toEqual([0.9, 0.7]);
  expect(await page.locator(labels).evaluateAll((nodes) => nodes.flatMap((node) => node.getAnimations()).length)).toBe(0);
  expect(await pendingFrames(page)).toBe(0);
});

test("loads the projection stylesheet from the head with a long cache", async ({ page, request }) => {
  await page.goto("/");
  const links = await page.evaluate(() => ({
    head: [...document.head.querySelectorAll('link[rel="stylesheet"][href^="/globe-projection/"]')].map((link) => link.getAttribute("href")),
    body: document.body.querySelectorAll('link[href^="/globe-projection/"]').length,
  }));
  expect(links.head).toHaveLength(1);
  expect(links.body, "the body must not hold a stylesheet that blocks the parser").toBe(0);
  expect(links.head[0]).toMatch(/^\/globe-projection\/[a-f0-9]{16}\.css$/);
  const response = await request.get(links.head[0]);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/css");
  expect(response.headers()["cache-control"], "the versioned URL can stay cached").toBe("public, max-age=31536000, immutable");
});

/** Change model inputs in an isolated build. Keep the production source intact. */
async function createGlobeBuild() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "cristianai-globe-")));
  const cleanup = () => rm(directory, { recursive: true, force: true });
  try {
    await Promise.all([
      cp(join(root, "src"), join(directory, "src"), { recursive: true }),
      cp(join(root, "public"), join(directory, "public"), { recursive: true }),
      cp(join(root, "package.json"), join(directory, "package.json")),
      cp(join(root, "tsconfig.json"), join(directory, "tsconfig.json")),
      symlink(join(root, "node_modules"), join(directory, "node_modules"), "dir"),
    ]);
    const modelPath = join(directory, "src", "lib", "lyra-globe", "model.ts");
    let model = await readFile(modelPath, "utf8");
    for (const [before, after] of [
      ["GLOBE_WIDTH = 600", "GLOBE_WIDTH = 720"],
      ["GLOBE_HEIGHT = 500", "GLOBE_HEIGHT = 560"],
      ["width * 0.51", "width * 0.54"],
      ["height * 0.49", "height * 0.46"],
      ["Math.min(width, height) * 0.34", "Math.min(width, height) * 0.29"],
      ["VEGA_OFFSET_X = 0.12", "VEGA_OFFSET_X = 0.16"],
      ["radius * 1.13", "radius * 1.2"],
    ]) model = model.replaceAll(before, after);
    await writeFile(modelPath, model);
    await writeFile(join(directory, "astro.config.mjs"),
      `import config from ${JSON.stringify(pathToFileURL(join(root, "astro.config.mjs")).href)};\n` +
      "export default { ...config, cacheDir: './.cache/', vite: { ...config.vite, cacheDir: './.cache/vite/' } };\n");
    await promisify(execFile)(process.execPath, [join(root, "node_modules", "astro", "bin", "astro.mjs"), "build", "--root", directory], {
      cwd: directory,
      env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" },
      timeout: 60000,
      maxBuffer: 5000000,
    });
    return { dist: join(directory, "dist"), cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

async function readProjection(page) {
  return page.evaluate(() => {
    const host = document.querySelector(".hero__globe");
    const hostBox = host.getBoundingClientRect();
    const style = getComputedStyle(host);
    const canvas = document.querySelector(".lyra-globe__canvas").getBoundingClientRect();
    const svg = document.querySelector("[data-lyra-globe] template").content.querySelector("svg");
    const ring = [...svg.querySelectorAll("ellipse")].sort((a, b) => b.rx.baseVal.value * b.ry.baseVal.value - a.rx.baseVal.value * a.ry.baseVal.value)[0];
    const vega = svg.querySelector('circle.is-hot[r="4.1"]');
    return {
      width: svg.viewBox.baseVal.width,
      height: svg.viewBox.baseVal.height,
      cx: ring.cx.baseVal.value,
      cy: ring.cy.baseVal.value,
      radius: ring.rx.baseVal.value,
      vegaY: vega.cy.baseVal.value,
      inset: parseFloat(style.getPropertyValue("--figure-inset")),
      limits: {
        max: parseFloat(style.getPropertyValue("--globe-max")),
        size: parseFloat(style.getPropertyValue("--frame")) * 0.55 - 5,
        height: innerHeight - ["--header-height", "--head-top", "--footer-reserve"].reduce((sum, name) => sum + parseFloat(style.getPropertyValue(name)), 0)
          - 2 * parseFloat(style.getPropertyValue("--globe-gap")),
        room: innerWidth - hostBox.left,
        fade: parseFloat(style.getPropertyValue("--fade")),
      },
      host: { width: hostBox.width, height: hostBox.height },
      canvas: { x: canvas.left - hostBox.left, y: canvas.top - hostBox.top, width: canvas.width, height: canvas.height },
      underlay: { x: parseFloat(getComputedStyle(host, "::before").left), y: parseFloat(getComputedStyle(host, "::before").top) },
      href: document.querySelector('link[href^="/globe-projection/"]').getAttribute("href"),
    };
  });
}

test("updates served globe geometry when the model changes", async ({ page }) => {
  test.setTimeout(90000);
  await useReducedMotion(page);
  const response = await page.goto("/");
  await expect(page.locator(globe)).toHaveAttribute("data-ready", "true");
  await settle(page);
  const original = await readProjection(page);
  const headers = response.headers();
  const policy = Object.fromEntries(Object.entries(headers).filter(([name]) => ["content-security-policy", "x-content-type-options"].includes(name)));
  expect(policy["content-security-policy"]).toContain("style-src 'self'");
  expect(policy["content-security-policy"]).toContain("style-src-attr 'none'");
  const fixture = await createGlobeBuild();
  const origin = new URL(page.url()).origin;
  const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".woff2": "font/woff2" };
  try {
    await page.route(`${origin}/**`, async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      const file = join(fixture.dist, pathname === "/" ? "index.html" : pathname);
      try {
        await route.fulfill({ body: await readFile(file), headers: { ...policy, "content-type": types[extname(file)] ?? "application/octet-stream" } });
      } catch { await route.continue(); }
    });
    const round = (value) => Math.round(value * 10000) / 10000;
    // Keep the approved crop during the model change.
    const pictureScale = 1.3;
    const pictureHeight = 1.2019;
    for (const viewport of [VIEWPORTS.desktop, { width: 1100, height: 800 }, VIEWPORTS.tablet, VIEWPORTS.mobile,
      { width: 1920, height: 1080 }, { width: 360, height: 740 }]) {
      await page.setViewportSize(viewport);
      await page.goto("/");
      await expect(page.locator(globe)).toHaveAttribute("data-ready", "true");
      await settle(page);
      const read = await readProjection(page);
      expect(read.width).toBe(720);
      expect(read.height).toBe(560);
      // SVG lengths use single precision.
      expect(read.cx / read.width).toBeCloseTo(0.54, 6);
      expect(read.cy / read.height).toBeCloseTo(0.46, 6);
      expect(read.href).not.toBe(original.href);
      const aspect = round(read.height / read.width);
      if (viewport.width >= 1100) {
        const ringInset = round((read.cx - read.radius) / read.width * pictureScale);
        const boxAspect = round(aspect * pictureScale / pictureHeight);
        const centerReach = round(read.radius / read.width * pictureScale);
        const expectedWidth = Math.min(read.limits.max, read.limits.size, Math.max(260, read.limits.height / boxAspect),
          (read.limits.room - read.inset - 68 - read.limits.fade) / centerReach);
        expect(Math.abs(read.host.width - expectedWidth)).toBeLessThan(0.03);
        expect(Math.abs(read.canvas.x - (read.inset - ringInset * read.host.width))).toBeLessThan(0.03);
        expect(Math.abs(read.host.height - read.host.width * boxAspect)).toBeLessThan(0.03);
        expect(Math.abs(read.underlay.x - read.host.width * read.cx / read.width)).toBeLessThan(0.03);
        expect(Math.abs(read.underlay.y - read.host.height * read.cy / read.height)).toBeLessThan(0.03);
      } else {
        expect(Math.abs(read.canvas.x - (read.host.width / 2 - read.canvas.width * read.cx / read.width))).toBeLessThan(0.03);
        expect(Math.abs(read.canvas.y - (read.host.height * 0.486 - read.canvas.width * read.vegaY / read.width))).toBeLessThan(0.03);
        expect(Math.abs(read.canvas.height - read.canvas.width * aspect)).toBeLessThan(0.03);
      }
      expect(await page.locator("style, [style]").count()).toBe(0);
    }
  } finally { await fixture.cleanup(); }
});
