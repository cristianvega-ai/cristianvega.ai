import { expect, test } from "@playwright/test";

import { currentContent, currentPublished, DRAFT_ORIGIN as dev, latestWork, pageProblems, setHomepageState, settle, tabTo, useManualFrames, useReducedMotion, VIEWPORTS, pendingFrames, playFrames } from "./fixtures.mjs";

/**
 * The homepage: one screen with the intro, two calls to action for Writing
 * and Products, and the Lyra globe. A call to action links only when its
 * section has visible content. Production comes from the built site on the
 * base URL. The Markdown publication state controls each entry link.
 * The dev server also shows drafts.
 */

const globe = "[data-lyra-globe]";
const WIDTHS = { ...VIEWPORTS, wide: { width: 1920, height: 1080 }, narrow: { width: 360, height: 740 } };
/** The screens where the homepage must fit with no scrolling. Below 1100px the page can scroll. */
const SCREENS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1100, height: 800 },
];
/** The screens where the globe sits in a band above the intro. */
const BAND_SCREENS = [
  { width: 1024, height: 768 },
  { width: 820, height: 1180 },
  { width: 390, height: 844 },
  { width: 360, height: 740 },
];

test.describe("the globe is decorative", () => {
  test.use({ viewport: VIEWPORTS.desktop });

  test("hides from assistive technology and takes no pointer input", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(globe)).toHaveAttribute("data-ready", "true");

    const state = await page.evaluate((selector) => {
      const root = document.querySelector(selector);
      const parts = [root, root.querySelector("svg"), root.querySelector("canvas")];
      return {
        hidden: root.getAttribute("aria-hidden"),
        pointerEvents: parts.map((part) => getComputedStyle(part).pointerEvents),
        focusable: root.querySelectorAll("a, button, input, select, textarea, [tabindex]").length,
        inHeading: Boolean(root.closest("h1, h2, h3")),
      };
    }, globe);

    expect(state.hidden).toBe("true");
    expect(state.pointerEvents).toEqual(["none", "none", "none"]);
    expect(state.focusable).toBe(0);
    expect(state.inHeading).toBe(false);
  });

  test("leaves the real content readable", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1")).toHaveText("Cristian Vega");
    await expect(page.getByRole("link", { name: /More about me/ })).toHaveCount(0);
    await expect(page.locator(".hero__lede")).toBeVisible();
    await expect(page.locator(".hero__thesis")).toBeVisible();
  });
});

/**
 * Measure the light in one or two screenshots of the globe box. The ground is
 * the most common luminance, so the page colour does not count. Returns the
 * mean lift above the ground for each picture. For two pictures it also
 * returns how far they differ, mark for mark, as a share of the first one's
 * light.
 */
async function measureLight(page, ...shots) {
  return page.evaluate(async (list) => {
    const decode = async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const scratch = new OffscreenCanvas(bitmap.width, bitmap.height);
      const scratchContext = scratch.getContext("2d");
      scratchContext.drawImage(bitmap, 0, 0);
      const { data } = scratchContext.getImageData(0, 0, bitmap.width, bitmap.height);
      const luminance = new Float32Array(data.length / 4);
      const counts = new Map();
      for (let i = 0; i < luminance.length; i += 1) {
        luminance[i] = 0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2];
        const key = Math.round(luminance[i]);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      let ground = 0;
      let most = 0;
      for (const [key, count] of counts) {
        if (count > most) {
          most = count;
          ground = key;
        }
      }
      let lift = 0;
      for (let i = 0; i < luminance.length; i += 1) lift += Math.max(0, luminance[i] - ground);
      return { luminance, mean: lift / luminance.length };
    };
    const pictures = await Promise.all(list.map(decode));
    let diff = 0;
    if (pictures.length > 1) {
      const [one, two] = pictures;
      let sum = 0;
      for (let i = 0; i < one.luminance.length; i += 1) sum += Math.abs(one.luminance[i] - two.luminance[i]);
      diff = sum / one.luminance.length / one.mean;
    }
    return { means: pictures.map((picture) => picture.mean), diff };
  }, shots.map((shot) => shot.toString("base64")));
}

/**
 * Take a screenshot of the part of the globe box that the screen shows. The box runs past the
 * right edge of the screen from 1100px, and the part past the edge is blank. Blank ground would
 * dilute the mean light, so the comparisons read only the visible part.
 */
async function shootGlobe(page) {
  const box = await page.locator(globe).boundingBox();
  const visibleWidth = Math.min(box.width, page.viewportSize().width - box.x);
  return page.screenshot({ clip: { x: box.x, y: box.y, width: visibleWidth, height: box.height } });
}

/** The picture of a visitor without JavaScript: the SVG in the noscript. */
async function readPlainGlobe(browser, baseURL, viewport) {
  const plain = await browser.newContext({ javaScriptEnabled: false, viewport });
  const plainPage = await plain.newPage();
  await plainPage.goto(new URL("/", baseURL).href);
  await settle(plainPage);
  const shot = await shootGlobe(plainPage);
  await plain.close();
  return shot;
}

test.describe("the globe draws without its canvas", () => {
  test.use({ viewport: VIEWPORTS.desktop });

  test("shows the SVG when JavaScript is off", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: VIEWPORTS.desktop });
    const page = await context.newPage();
    await page.goto(new URL("/", baseURL).href);

    const svg = page.locator(`${globe} .lyra-globe__fallback`);
    await expect(svg).toBeVisible();
    await expect(svg).toHaveCSS("opacity", "1");
    await expect(page.locator(`${globe} canvas`)).toBeHidden();
    await expect(page.locator(globe)).not.toHaveAttribute("data-ready", /.*/);
    expect((await svg.boundingBox()).width).toBeGreaterThan(300);
    // The route and the figure are in the picture, not only the sphere.
    expect(await svg.locator("path.is-hot").count()).toBeGreaterThanOrEqual(10);
    // The labels show at full strength with no script to reveal them.
    await expect(page.locator(`${globe} .lyra-globe__labels`)).toHaveCSS("opacity", "1");
    await expect(page.locator(`${globe} text`).first()).toBeVisible();
    await expect(page.locator("h1")).toBeVisible();
    await context.close();
  });

  test("copies the SVG in when the canvas cannot draw", async ({ page }) => {
    await page.addInitScript(() => {
      HTMLCanvasElement.prototype.getContext = () => null;
    });
    await page.goto("/");
    await page.waitForFunction(() => document.readyState === "complete");
    await page.evaluate(() => document.fonts.ready);

    const svg = page.locator(`${globe} .lyra-globe__fallback`);
    await expect(svg).toHaveCount(1);
    await expect(svg).toBeVisible();
    await expect(svg).toHaveCSS("opacity", "1");
    expect((await svg.boundingBox()).width).toBeGreaterThan(300);
    expect(await svg.locator("path.is-hot").count()).toBeGreaterThanOrEqual(10);
    await expect(page.locator(globe)).not.toHaveAttribute("data-ready", /.*/);
    await expect(page.locator(globe)).not.toHaveAttribute("data-motion-state", /.*/);
    // The labels show with the copy, because no canvas will reveal them.
    await expect(page.locator(`${globe} .lyra-globe__labels`)).toHaveCSS("opacity", "1");
  });

  test("copies the SVG in when the setup fails", async ({ page }) => {
    await page.addInitScript(() => {
      window.ResizeObserver = class {
        constructor() {
          throw new Error("setup failed");
        }
      };
    });
    await page.goto("/");
    await expect(page.locator(`${globe} .lyra-globe__fallback`)).toBeVisible();
    await expect(page.locator(globe)).not.toHaveAttribute("data-ready", /.*/);
  });

  test("draws no SVG while the canvas works", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(globe)).toHaveAttribute("data-ready", "true");
    await expect(page.locator(`${globe} .lyra-globe__fallback`)).toHaveCount(0);
    await expect(page.locator(`${globe} canvas`)).toBeVisible();
    await expect(page.locator(`${globe} canvas`)).toHaveCSS("opacity", "1");
    // The only SVG in the box is the label layer. The spare copy is inert in a template.
    expect(await page.locator(`${globe} svg`).count()).toBe(1);
    expect(await page.locator(`${globe} template`).count()).toBe(1);
  });
});

test.describe("the globe entrance", () => {
  test.use({ viewport: VIEWPORTS.desktop });

  test("shows no SVG at any frame of the load and the entrance", async ({ page }) => {
    await page.addInitScript(() => {
      window.__fallbacks = 0;
      window.__frames = 0;
      const check = () => {
        const root = document.querySelector("[data-lyra-globe]");
        if (root) {
          window.__frames += 1;
          if (root.querySelector(".lyra-globe__fallback")) window.__fallbacks += 1;
        }
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
    await page.goto("/");
    await expect(page.locator(globe)).toHaveAttribute("data-motion-state", "still", { timeout: 10_000 });
    await expect.poll(() => page.evaluate(() => window.__frames)).toBeGreaterThan(40);
    expect(await page.evaluate(() => window.__fallbacks)).toBe(0);
  });

  test("reveals the picture: it starts empty, grows, and ends on the finished SVG", async ({ browser, baseURL, page }) => {
    const plain = await readPlainGlobe(browser, baseURL, VIEWPORTS.desktop);
    const [full] = (await measureLight(page, plain)).means;

    await useManualFrames(page);
    await page.goto("/");
    await expect(page.locator(globe)).toHaveAttribute("data-ready", "true");
    await expect(page.locator(globe)).toHaveAttribute("data-motion-state", "playing");

    const look = async () => (await measureLight(page, await shootGlobe(page))).means[0];
    // The grid lines behind the box hold some light too. Read them alone, with
    // the canvas and the labels hidden, so the frames are measured above them.
    const layers = page.locator(`${globe} canvas, ${globe} .lyra-globe__labels`);
    await layers.evaluateAll((list) => list.forEach((layer) => { layer.style.visibility = "hidden"; }));
    const empty = await look();
    await layers.evaluateAll((list) => list.forEach((layer) => { layer.style.visibility = ""; }));
    const levels = [await look()];
    // The first frame starts the clock. Then each step plays 300 ms in 16 ms frames, under the 64 ms cap.
    await playFrames(page, 16);
    for (let step = 0; step < 7; step += 1) {
      await playFrames(page, 300);
      levels.push(await look());
    }
    await playFrames(page, 2400);
    await expect(page.locator(globe)).toHaveAttribute("data-motion-state", "still");
    // Wait for the fonts after the canvas clock finishes the labels.
    await settle(page);
    const last = await shootGlobe(page);
    const [final] = (await measureLight(page, last)).means;
    const match = await measureLight(page, plain, last);

    // How much of the finished picture each frame holds, from 0 to 1.
    const share = levels.map((level) => (level - empty) / (full - empty));
    expect(share[0], "the first frame is nearly empty").toBeLessThan(0.05);
    expect(share[3], "the middle of the entrance holds part of the picture").toBeGreaterThan(0.2);
    expect(share[3], "the middle of the entrance is not yet complete").toBeLessThan(0.9);
    for (let i = 1; i < 6; i += 1) expect(share[i], `frame ${i} adds to frame ${i - 1}`).toBeGreaterThanOrEqual(share[i - 1] - 0.02);
    // The last frame is the finished picture: it matches the SVG closely. The canvas draws the thin
    // lines a few percent dimmer than the SVG. The screen shows 78% of the box at 1440px, and that
    // share holds more thin lines and less grid, so the allowance is 4.5% and no longer 3%.
    expect(Math.abs(final - full) / full, "the final light matches the SVG").toBeLessThan(0.045);
    expect(match.diff, "the final frame matches the SVG mark for mark").toBeLessThan(0.3);
  });

  test("reduced motion paints the finished picture on the first frame", async ({ browser, baseURL, page }) => {
    const plain = await readPlainGlobe(browser, baseURL, VIEWPORTS.desktop);
    await useManualFrames(page);
    await useReducedMotion(page);
    await page.goto("/");
    await expect(page.locator(globe)).toHaveAttribute("data-ready", "true");
    await expect(page.locator(globe)).toHaveAttribute("data-motion-state", "still");
    expect(await pendingFrames(page)).toBe(0);
    await settle(page);

    const shown = await shootGlobe(page);
    const match = await measureLight(page, plain, shown);
    // The allowance is 4.5% for the reason given in the entrance test above.
    expect(Math.abs(match.means[1] - match.means[0]) / match.means[0], "the light matches the SVG").toBeLessThan(0.045);
    expect(match.diff, "the picture matches the SVG mark for mark").toBeLessThan(0.3);
  });

  test("finishes within three seconds and is not instant", async ({ page }) => {
    await page.addInitScript(() => {
      window.__times = {};
      new MutationObserver((records) => {
        for (const record of records) {
          const state = record.target.dataset.motionState;
          if (state && !(state in window.__times)) window.__times[state] = performance.now();
        }
      }).observe(document, { attributes: true, attributeFilter: ["data-motion-state"], subtree: true });
    });
    await page.goto("/");
    await expect(page.locator(globe)).toHaveAttribute("data-motion-state", "still", { timeout: 10_000 });
    const times = await page.evaluate(() => window.__times);
    expect(times.still - times.playing, "the entrance is longer than a blink").toBeGreaterThan(1500);
    expect(times.still - times.playing, "the entrance ends within three seconds").toBeLessThan(3000);
  });
});

test.describe("the globe labels", () => {
  test.use({ viewport: VIEWPORTS.desktop });

  for (const viewport of [VIEWPORTS.desktop, VIEWPORTS.mobile, WIDTHS.narrow]) {
    test(`keeps the labels at a readable pixel size, the same with and without the canvas, at ${viewport.width}px`, async ({ browser, baseURL, page }) => {
      const read = () => page.evaluate(() => {
        const root = document.querySelector("[data-lyra-globe]");
        const rootBox = root.getBoundingClientRect();
        return [...root.querySelectorAll("text")].map((text) => {
          const box = text.getBoundingClientRect();
          return {
            text: text.textContent,
            size: parseFloat(getComputedStyle(text).fontSize),
            shown: getComputedStyle(text).display !== "none",
            // Measure the drawn box, not the CSS value: a scaled svg unit would show here.
            height: box.height,
            width: box.width,
            left: box.left - rootBox.left,
            top: box.top - rootBox.top,
            inside: box.left >= rootBox.left - 1 && box.right <= rootBox.right + 1,
          };
        });
      });

      await page.setViewportSize(viewport);
      await useReducedMotion(page);
      await page.goto("/");
      await expect(page.locator(globe)).toHaveAttribute("data-motion-state", "still");
      // Wait out the entrance animations and the font load, as the plain page does.
      await settle(page);
      await page.evaluate(() => document.fonts.ready);
      const withCanvas = await read();

      const plain = await browser.newContext({ javaScriptEnabled: false, viewport });
      const plainPage = await plain.newPage();
      await plainPage.goto(new URL("/", baseURL).href);
      await settle(plainPage);
      const withoutCanvas = await plainPage.evaluate(() => [...document.querySelectorAll("[data-lyra-globe] text")].map((text) => {
        const box = text.getBoundingClientRect();
        const rootBox = document.querySelector("[data-lyra-globe]").getBoundingClientRect();
        return { text: text.textContent, size: parseFloat(getComputedStyle(text).fontSize), left: box.left - rootBox.left, top: box.top - rootBox.top };
      }));
      await plain.close();

      const vega = withCanvas.find((label) => label.text === "VEGA");
      expect(vega, "the Vega label stays at every size").toBeTruthy();
      for (const label of withCanvas.filter((entry) => entry.shown)) {
        expect(label.size, `${label.text} font size`).toBeGreaterThanOrEqual(10);
        // A 10px mono face is at least 5px tall as drawn and 6px wide a letter.
        expect(label.height, `${label.text} drawn height`).toBeGreaterThanOrEqual(9);
        expect(label.width, `${label.text} drawn width`).toBeGreaterThanOrEqual(label.text.length * 5.5);
        expect(label.inside, `${label.text} stays inside the globe box`).toBe(true);
      }
      // The same text sits in the same place with and without the canvas.
      for (const label of withCanvas.filter((entry) => entry.shown)) {
        const twin = withoutCanvas.find((entry) => entry.text === label.text);
        expect(Math.abs(twin.size - label.size)).toBeLessThanOrEqual(0.01);
        expect(Math.abs(twin.left - label.left)).toBeLessThanOrEqual(1);
        expect(Math.abs(twin.top - label.top)).toBeLessThanOrEqual(1);
      }
    });
  }
});

test.describe("the globe motion", () => {
  test.use({ viewport: VIEWPORTS.desktop });

  test("plays the entrance and ends still", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(globe)).toHaveAttribute("data-motion-state", "still", { timeout: 10_000 });
    await expect(page.locator(globe)).toHaveAttribute("data-ready", "true");
  });

  test("reduced motion draws the end state at once and never plays", async ({ page }) => {
    await useManualFrames(page);
    await useReducedMotion(page);
    await page.goto("/");

    await expect(page.locator(globe)).toHaveAttribute("data-ready", "true");
    await expect(page.locator(globe)).toHaveAttribute("data-motion-state", "still");
    expect(await pendingFrames(page)).toBe(0);
  });

  test("runs to the end when its frames run, then queues no more", async ({ page }) => {
    await useManualFrames(page);
    await page.goto("/");
    await expect(page.locator(globe)).toHaveAttribute("data-motion-state", "playing");
    expect(await pendingFrames(page)).toBe(1);

    await playFrames(page, 1000);
    await expect(page.locator(globe)).toHaveAttribute("data-motion-state", "playing");
    await playFrames(page, 2000);
    await expect(page.locator(globe)).toHaveAttribute("data-motion-state", "still");
    expect(await pendingFrames(page)).toBe(0);
  });

  test("stops its frames while the tab is hidden and resumes when it returns", async ({ page }) => {
    await useManualFrames(page);
    await page.goto("/");
    await expect(page.locator(globe)).toHaveAttribute("data-motion-state", "playing");
    expect(await pendingFrames(page)).toBe(1);

    const setHidden = (hidden) =>
      page.evaluate((value) => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => value });
        document.dispatchEvent(new Event("visibilitychange"));
      }, hidden);

    await setHidden(true);
    expect(await pendingFrames(page)).toBe(0);
    await setHidden(false);
    expect(await pendingFrames(page)).toBe(1);
  });

  test("cancels its frames on pagehide and starts again on a restored page", async ({ page }) => {
    await useManualFrames(page);
    await page.goto("/");
    await expect(page.locator(globe)).toHaveAttribute("data-motion-state", "playing");
    expect(await pendingFrames(page)).toBe(1);

    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
    expect(await pendingFrames(page)).toBe(0);
    await expect(page.locator(globe)).not.toHaveAttribute("data-ready", /.*/);
    await expect(page.locator(globe)).not.toHaveAttribute("data-motion-state", /.*/);
    await expect(page.locator(`${globe} .lyra-globe__fallback`)).toHaveCount(0);

    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    await expect(page.locator(globe)).toHaveAttribute("data-ready", "true");
    await expect(page.locator(globe)).toHaveAttribute("data-motion-state", "playing");
    await expect.poll(() => pendingFrames(page)).toBe(1);
  });

  test("pauses while the globe is off-screen and resumes when it returns", async ({ page }) => {
    await useManualFrames(page);
    await page.goto(dev + "/");
    await expect(page.locator(globe)).toHaveAttribute("data-motion-state", "playing");
    await expect.poll(() => pendingFrames(page)).toBe(1);

    // The homepage fits one screen and does not scroll. Add a tall block below
    // it so the globe can leave the screen.
    await page.evaluate(() => {
      const spacer = document.createElement("div");
      spacer.style.height = "3000px";
      document.querySelector("#main-content").after(spacer);
    });

    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
    await expect.poll(() => pendingFrames(page)).toBe(0);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await expect.poll(() => pendingFrames(page)).toBe(1);
  });

  test("resizes the canvas to the globe's box", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(globe)).toHaveAttribute("data-ready", "true");

    for (const size of [VIEWPORTS.mobile, VIEWPORTS.desktop]) {
      await page.setViewportSize(size);
      await expect
        .poll(() =>
          page.evaluate((selector) => {
            const canvas = document.querySelector(`${selector} canvas`);
            const box = canvas.getBoundingClientRect();
            // The test browser runs at a pixel ratio of 1.
            return Math.abs(canvas.width - Math.round(box.width * devicePixelRatio)) <= 1
              && Math.abs(canvas.height - Math.round(box.height * devicePixelRatio)) <= 1;
          }, globe),
        )
        .toBe(true);
    }
  });
});

for (const [name, viewport] of Object.entries(WIDTHS)) {
  test.describe(`${name} homepage layout`, () => {
    test.use({ viewport });

    test("fits the screen with the intro and the globe apart", async ({ page }) => {
      await page.goto("/");
      await settle(page);

      const layout = await page.evaluate((selector) => {
        const rect = (query) => document.querySelector(query).getBoundingClientRect();
        const main = rect(".hero__main");
        const art = rect(selector);
        const title = document.querySelector("h1");
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          main: { left: main.left, right: main.right, top: main.top, bottom: main.bottom },
          art: { left: art.left, right: art.right, top: art.top, bottom: art.bottom, width: art.width },
          titleClipped: title.scrollWidth > title.clientWidth,
          width: document.documentElement.clientWidth,
        };
      }, globe);

      expect(layout.overflow).toBeLessThanOrEqual(1);
      expect(layout.titleClipped).toBe(false);
      if (viewport.width >= 1100) {
        // Side by side: the globe sits to the right of the intro. Its box runs past the screen edge,
        // and the screen shows most of it.
        expect(layout.art.width).toBeGreaterThanOrEqual(400);
        expect(layout.art.left).toBeGreaterThanOrEqual(layout.main.right - 0.5);
        expect((layout.width - layout.art.left) / layout.art.width, "the screen shows most of the globe box").toBeGreaterThanOrEqual(0.65);
      } else {
        // Stacked: the globe band sits above the intro, inside the screen.
        expect(layout.art.width).toBeGreaterThanOrEqual(Math.min(680, viewport.width - 40) - 1);
        expect(layout.art.bottom).toBeLessThanOrEqual(layout.main.top + 0.5);
        expect(layout.art.left).toBeGreaterThanOrEqual(0);
        expect(layout.art.right).toBeLessThanOrEqual(layout.width + 0.5);
      }
    });

    test("keeps entry links and navigation consistent with current publication", async ({ page, request }) => {
      await page.goto("/");
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.locator("main h2")).toHaveCount(0);
      await expect(page.locator("[data-article-identifier], [data-product-identifier]")).toHaveCount(0);
      await expect(page.locator("a[href='#']")).toHaveCount(0);
      await expect(page.getByText("More about me")).toHaveCount(0);

      const items = page.locator(".hero__next-item");
      const live = latestWork.map((item) => currentPublished[item.section].length > 0);
      await expect(items).toHaveText(latestWork.map((item, index) => live[index] ? `${item.label} →` : item.soon));
      expect(await items.evaluateAll((nodes) => nodes.map((node) => node.dataset.state))).toEqual(live.map((visible) => visible ? "live" : "soon"));
      const focusable = await page.locator(".hero__next").evaluate((list) => list.querySelectorAll("a, button, [tabindex]").length);
      expect(focusable).toBe(live.filter(Boolean).length);
      for (const [index, item] of latestWork.entries()) {
        await expect(page.locator(`.nav__link[href='${item.href}'], .nav-menu__link[href='${item.href}']`)).toHaveCount(live[index] ? 2 : 0);
        await expect(page.locator(`a[href^='/${item.section}']`)).toHaveCount(live[index] ? 3 : 0);
        await expect(items.nth(index).locator("a")).toHaveCount(live[index] ? 1 : 0);
        if (live[index]) await expect(items.nth(index).locator("a")).toHaveAttribute("href", item.href);
        expect((await request.get(item.href)).status()).toBe(live[index] ? 200 : 404);
        for (const draft of currentContent[item.section].filter((entry) => entry.data.draft)) {
          expect((await request.get(draft.href)).status(), draft.href).toBe(404);
        }
      }
    });

    test("shows two links and no lists with the drafts on the dev server", async ({ page }) => {
      const errors = pageProblems(page);
      await page.goto(dev + "/");
      await settle(page);

      // The Astro dev toolbar adds its own headings, so scope to main.
      await expect(page.locator("main h1")).toHaveCount(1);
      await expect(page.locator("main h2")).toHaveCount(0);
      await expect(page.locator("[data-article-identifier], [data-product-identifier]")).toHaveCount(0);

      const links = page.locator(".hero__next a");
      await expect(links).toHaveCount(2);
      await expect(links.nth(0)).toHaveAttribute("href", "/writing/");
      await expect(links.nth(1)).toHaveAttribute("href", "/products/");
      expect(await page.locator(".hero__next-item").evaluateAll((nodes) => nodes.map((node) => node.dataset.state))).toEqual(["live", "live"]);
      await expect(page.locator(".hero__next")).not.toContainText("coming soon");
      // The arrow is decoration, so the accessible name is the words alone.
      await expect(page.getByRole("link", { name: "Read my latest writing", exact: true })).toHaveAttribute("href", "/writing/");
      await expect(page.getByRole("link", { name: "See my latest products", exact: true })).toHaveAttribute("href", "/products/");
      await expect(links).toHaveText(["Read my latest writing →", "See my latest products →"]);
      await expect(page.getByText("More about me")).toHaveCount(0);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      expect(errors).toEqual([]);
    });
  });
}

for (const viewport of [VIEWPORTS.desktop, VIEWPORTS.mobile, WIDTHS.narrow]) {
  test(`the home eyebrow keeps its clauses whole, clear of the header, at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await settle(page);
    const state = await page.locator(".hero .eyebrow").evaluate((eyebrow) => {
      const [first, second] = [...eyebrow.querySelectorAll(".eyebrow__part")].map((part) => part.getBoundingClientRect());
      return {
        box: eyebrow.getBoundingClientRect().toJSON(), first, second, text: eyebrow.textContent,
        headerBottom: document.querySelector(".site-header").getBoundingClientRect().bottom,
        bandBottom: document.querySelector(".hero__globe").getBoundingClientRect().bottom,
        fontSize: parseFloat(getComputedStyle(eyebrow).fontSize),
        toName: document.querySelector("h1").getBoundingClientRect().top - eyebrow.getBoundingClientRect().bottom,
        ledeToThesis: document.querySelector(".hero__thesis").getBoundingClientRect().top - document.querySelector(".hero__lede").getBoundingClientRect().bottom,
        thesisToNext: document.querySelector(".hero__next").getBoundingClientRect().top - document.querySelector(".hero__thesis").getBoundingClientRect().bottom,
      };
    });
    expect(state.text.replace(/\s+/g, " ").trim()).toBe("AI Engineering Leader Agentic Systems");
    // The eyebrow has the style of every inner page. Above a phone it is one line: the second
    // clause starts after the first ends, on the same row. On a phone the clauses can wrap,
    // as they do on the inner pages, and each clause stays on one line.
    if (viewport.width > 540) {
      expect(state.second.top).toBeLessThan(state.first.bottom - 1);
      expect(state.second.left).toBeGreaterThanOrEqual(state.first.right - 1);
    } else {
      expect(state.second.top).toBeGreaterThanOrEqual(state.first.bottom - 1);
      expect(state.first.height).toBeLessThan(state.fontSize * 2);
      expect(state.second.height).toBeLessThan(state.fontSize * 2);
    }
    expect(state.fontSize).toBe(12);
    // The eyebrow sits the head room under the header, or under the globe band below 1100px, as on
    // every inner page.
    const above = viewport.width < 1100 ? state.bandBottom : state.headerBottom;
    expect(state.box.top - above, "the eyebrow clears what is above it").toBe(viewport.width > 760 ? 72 : 48);
    // The intro keeps a steady rhythm on a phone. A tall phone has room and
    // gets the larger set. A short phone gets the tight set, which still keeps
    // the gaps clear of the crowded 5px to 8px of the old intro.
    if (viewport.width < 540) {
      const tall = viewport.height >= 800;
      expect(state.toName, "the eyebrow clears the name").toBeGreaterThanOrEqual(tall ? 14 : 10);
      expect(state.ledeToThesis, "the lede clears the thesis").toBeGreaterThanOrEqual(tall ? 14 : 8);
      expect(state.thesisToNext, "the thesis clears the calls to action").toBeGreaterThanOrEqual(tall ? 16 : 10);
    }
  });
}

/** Read the box of the list of calls to action and of each row in it. */
const readNext = (page) => page.evaluate(() => {
  const plain = (el) => {
    const { left, top, right, bottom, width, height } = el.getBoundingClientRect();
    return { left, top, right, bottom, width, height };
  };
  return {
    list: plain(document.querySelector(".hero__next")),
    items: [...document.querySelectorAll(".hero__next-item")].map(plain),
    globe: plain(document.querySelector(".hero__globe")),
    canvas: plain(document.querySelector(".lyra-globe")),
  };
});

const overlaps = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;

for (const viewport of [WIDTHS.wide, VIEWPORTS.desktop, VIEWPORTS.tablet, VIEWPORTS.mobile, WIDTHS.narrow]) {
  test.describe(`the calls to action at ${viewport.width}px`, () => {
    test.use({ viewport });

    test("keep one box in both states, so the layout never shifts", async ({ page }) => {
      await page.goto("/");
      await settle(page);
      await setHomepageState(page, "soon");
      const soon = await readNext(page);
      await setHomepageState(page, "live");
      const live = await readNext(page);

      expect(soon.items).toHaveLength(2);
      expect(live.items).toHaveLength(2);
      // The two rows of one state match in height, and so do the two states.
      for (const [one, two] of [[soon.items[0], soon.items[1]], [live.items[0], live.items[1]], [soon.items[0], live.items[0]], [soon.items[1], live.items[1]]]) {
        expect(Math.abs(one.height - two.height)).toBeLessThanOrEqual(1);
      }
      // The list has one place and one size in both states.
      expect(Math.abs(soon.list.top - live.list.top)).toBeLessThanOrEqual(1);
      expect(Math.abs(soon.list.height - live.list.height)).toBeLessThanOrEqual(1);
      expect(Math.abs(soon.list.left - live.list.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(soon.list.width - live.list.width)).toBeLessThanOrEqual(1);
      // Each row is a comfortable target, and the rows sit one under the other.
      for (const row of live.items) expect(row.height).toBeGreaterThanOrEqual(44);
      expect(live.items[1].top).toBeGreaterThanOrEqual(live.items[0].bottom - 1);
    });

    for (const [state, markup] of [["coming-soon", "soon"], ["live", "live"]]) {
      test(`stay clear of the globe and inside the screen in the ${state} state`, async ({ page }) => {
        await page.goto("/");
        await settle(page);
        await setHomepageState(page, markup);
        const read = await readNext(page);
        const width = await page.evaluate(() => document.documentElement.clientWidth);
        for (const row of read.items) {
          expect(overlaps(row, read.globe), "a row must not overlap the globe").toBe(false);
          expect(overlaps(row, read.canvas), "a row must not overlap the globe picture").toBe(false);
          expect(row.left).toBeGreaterThanOrEqual(0);
          expect(row.right).toBeLessThanOrEqual(width + 0.5);
        }
      });
    }

    test("read as text with no arrow when a section is not live", async ({ page }) => {
      await page.goto("/");
      await settle(page);
      await setHomepageState(page, "soon");
      const state = await page.evaluate(() => {
        const soon = document.querySelector(".hero__next-soon");
        const style = getComputedStyle(soon);
        const thesis = getComputedStyle(document.querySelector(".hero__thesis"));
        return { color: style.color, thesisColor: thesis.color, cursor: style.cursor, arrow: Boolean(document.querySelector(".hero__next-arrow")), fontFamily: style.fontFamily };
      });
      expect(state.arrow, "a line that is not a link has no arrow").toBe(false);
      expect(state.cursor).not.toBe("pointer");
      expect(state.color, "the line is quieter than the thesis").not.toBe(state.thesisColor);
      expect(state.fontFamily, "the line keeps the mono type of the links").toMatch(/mono/i);
    });
  });
}

test.describe("the live calls to action", () => {
  test.use({ viewport: VIEWPORTS.desktop });

  test("take a visible focus ring, a hover state, and follow their links", async ({ page }) => {
    await page.goto(dev + "/");
    await settle(page);
    const link = page.getByRole("link", { name: "Read my latest writing", exact: true });
    const color = () => link.evaluate((el) => getComputedStyle(el).color);

    const box = await link.boundingBox();
    const resting = await color();
    await page.mouse.move(box.x + 8, box.y + box.height / 2);
    await expect.poll(color).not.toBe(resting);
    await page.mouse.move(2, 400);
    await expect.poll(color).toBe(resting);

    // The arrow steps right by at least 4px on hover, and rests at zero.
    const arrow = link.locator(".hero__next-arrow");
    const shift = () => arrow.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41);
    await page.mouse.move(box.x + 8, box.y + box.height / 2);
    await expect.poll(shift).toBeGreaterThanOrEqual(4);
    await page.mouse.move(2, 400);
    await expect.poll(shift).toBe(0);

    // Keyboard focus shows a ring of at least 2px.
    expect(await tabTo(page, ".hero__next a[href='/writing/']")).toBe(true);
    const ring = await page.evaluate(() => {
      const style = getComputedStyle(document.activeElement);
      return { width: parseFloat(style.outlineWidth), style: style.outlineStyle, visible: document.activeElement.matches(":focus-visible") };
    });
    expect(ring.visible).toBe(true);
    expect(ring.style).toBe("solid");
    expect(ring.width).toBeGreaterThanOrEqual(2);
    // The next Tab reaches Products, and that link shows a ring too.
    await page.keyboard.press("Tab");
    await expect(page.locator(".hero__next a[href='/products/']")).toBeFocused();
    expect(await page.evaluate(() => parseFloat(getComputedStyle(document.activeElement).outlineWidth))).toBeGreaterThanOrEqual(2);

    await link.click();
    await expect(page).toHaveURL(/\/writing\/$/);
  });
});

/**
 * Read the blueprint grid alone. The text and the pictures are hidden through
 * the CSSOM, so a screenshot holds only the ground and the grid. A grid line
 * is one column wide, so its strength is the brightness of a line column
 * minus a column 4px to its left. Returns the strength in the intro, the
 * header, the footer, the calls to action, the strips at the seams, and the strongest
 * cell, with the offset of the line columns from the content edge.
 */
async function readGrid(page) {
  const geometry = await page.evaluate(() => {
    const box = (selector) => {
      const { left, top, right, bottom, width, height } = document.querySelector(selector).getBoundingClientRect();
      return { left, top, right, bottom, width, height };
    };
    for (const selector of [".hero__main", ".lyra-globe", ".hero__next", ".site-header", ".site-footer"]) {
      document.querySelector(selector).style.visibility = "hidden";
    }
    const hero = box(".hero");
    return {
      intro: box(".hero__main"),
      globe: box(".lyra-globe"),
      cards: box(".hero__next"),
      header: box(".site-header"),
      footer: box(".site-footer"),
      hero,
      width: document.documentElement.clientWidth,
      height: window.innerHeight,
    };
  });
  const shot = await page.screenshot();
  return page.evaluate(async ({ base64, geometry: g }) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0);
    const { data, width } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const green = (x, y) => data[(y * width + x) * 4 + 1];
    const edge = Math.round(g.intro.left);
    // The mean strength of the line columns inside a rectangle.
    const strength = (left, top, right, bottom) => {
      let sum = 0;
      let count = 0;
      const first = edge + Math.ceil((Math.max(left, 4) - edge) / 40) * 40;
      for (let x = first; x < Math.min(right, g.width - 1); x += 40) {
        for (let y = Math.max(0, Math.floor(top)); y < Math.min(bottom, g.height); y += 2) {
          sum += green(x, y) - green(x - 4, y);
          count += 1;
        }
      }
      return count ? sum / count : 0;
    };
    // The strongest 120px cell across the room between the header and the footer.
    let peak = { contrast: -Infinity, x: 0, y: 0 };
    let quiet = 0;
    const all = [];
    let cells = 0;
    for (let top = g.hero.top; top + 120 <= g.hero.bottom; top += 60) {
      for (let left = 0; left + 120 <= g.width; left += 60) {
        const contrast = strength(left, top, left + 120, top + 120);
        cells += 1;
        if (contrast < 0.5) quiet += 1;
        all.push(contrast);
        if (contrast > peak.contrast) peak = { contrast, x: left + 60, y: top + 60 };
      }
    }
    // The column offset, in one tile, where the peak cell is brightest.
    let lineOffset = -1;
    let brightest = -Infinity;
    const start = edge + Math.ceil((peak.x - 60 - edge) / 40) * 40;
    for (let offset = 0; offset < 40; offset += 1) {
      let sum = 0;
      let count = 0;
      for (let column = start + offset; column < peak.x + 60; column += 40) {
        if (column < 4 || column >= g.width) continue;
        for (let y = peak.y - 60; y < peak.y + 60; y += 2) {
          sum += green(column, y);
          count += 1;
        }
      }
      const mean = count ? sum / count : -Infinity;
      if (mean > brightest + 1e-6) {
        brightest = mean;
        lineOffset = offset;
      }
    }
    return {
      peak,
      lineOffset,
      quiet: quiet / cells,
      strong: all.filter((contrast) => contrast >= peak.contrast / 2).length / cells,
      globe: g.globe,
      intro: strength(g.intro.left, g.intro.top, g.intro.right, g.intro.bottom),
      header: strength(0, g.header.top, g.width, g.header.bottom),
      footer: strength(0, g.footer.top, g.width, g.footer.bottom),
      cards: strength(g.cards.left, g.cards.top, g.cards.right, g.cards.bottom),
      below: strength(0, g.hero.bottom - 24, g.width, g.footer.top),
      headerSeam: strength(0, g.header.bottom, g.width, g.header.bottom + 24),
    };
  }, { base64: shot.toString("base64"), geometry });
}

/**
 * Read how far each pixel of a strip differs from the ground, with the text
 * and the pictures hidden. A grid line is 9% white on the ink, so a pixel on a
 * full-strength line differs by about 20 levels of green. A strip that holds
 * no line differs by 0 or 1. The strips lie along the four edges of the grid
 * layer, along the four edges of the screen, and along the header seam.
 */
async function readGridEdges(page) {
  const geometry = await page.evaluate(() => {
    for (const selector of [".hero__main", ".lyra-globe", ".hero__next", ".site-header", ".site-footer"]) {
      document.querySelector(selector).style.visibility = "hidden";
    }
    const host = document.querySelector(".hero__globe");
    const rect = host.getBoundingClientRect();
    const layer = getComputedStyle(host, "::after");
    return {
      layer: {
        left: rect.left + parseFloat(layer.left),
        top: rect.top + parseFloat(layer.top),
        width: parseFloat(layer.width),
        height: parseFloat(layer.height),
      },
      width: document.documentElement.clientWidth,
      height: window.innerHeight,
    };
  });
  const shot = await page.screenshot();
  return page.evaluate(async ({ base64, g }) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0);
    const { data, width, height } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const scale = bitmap.width / g.width;
    // The ground is the most common level of green.
    const counts = new Map();
    for (let i = 1; i < data.length; i += 4 * 97) counts.set(data[i], (counts.get(data[i]) ?? 0) + 1);
    const ground = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    // The largest difference from the ground in a strip, in CSS pixels.
    const strip = (left, top, right, bottom) => {
      let largest = 0;
      const x0 = Math.max(0, Math.round(left * scale));
      const x1 = Math.min(width, Math.round(right * scale));
      const y0 = Math.max(0, Math.round(top * scale));
      const y1 = Math.min(height, Math.round(bottom * scale));
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) largest = Math.max(largest, Math.abs(data[(y * width + x) * 4 + 1] - ground));
      }
      return largest;
    };
    const { layer } = g;
    const right = layer.left + layer.width;
    const bottom = layer.top + layer.height;
    const band = 6;
    return {
      layer,
      // The layer is not empty: its inside holds a full line somewhere.
      inside: strip(layer.left + layer.width * 0.15, layer.top + layer.height * 0.15, right - layer.width * 0.15, bottom - layer.height * 0.15),
      layerEdges: {
        left: strip(layer.left, layer.top, layer.left + band, bottom),
        right: strip(right - band, layer.top, right, bottom),
        top: strip(layer.left, layer.top, right, layer.top + band),
        bottom: strip(layer.left, bottom - band, right, bottom),
      },
      screenEdges: {
        left: strip(0, 0, band, g.height),
        right: strip(g.width - band, 0, g.width, g.height),
        top: strip(0, 0, g.width, band),
        bottom: strip(0, g.height - band, g.width, g.height),
      },
    };
  }, { base64: shot.toString("base64"), g: geometry });
}

test.describe("the homepage is one screen", () => {
  for (const screen of SCREENS) {
    test.describe(`${screen.width}x${screen.height}`, () => {
      test.use({ viewport: screen });

      test("does not scroll and keeps text, labels, and calls to action apart", async ({ page }) => {
        await page.goto("/");
        await settle(page);

        const fit = await page.evaluate(() => ({
          scrollHeight: document.documentElement.scrollHeight,
          innerHeight: window.innerHeight,
          overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          footerTop: document.querySelector(".site-footer").getBoundingClientRect().top,
          lastNextBottom: Math.max(...[...document.querySelectorAll(".hero__next-item")].map((item) => item.getBoundingClientRect().bottom)),
        }));
        expect(fit.scrollHeight).toBeLessThanOrEqual(fit.innerHeight);
        expect(fit.overflowX).toBeLessThanOrEqual(1);
        // The calls to action leave room above the footer bar at every size.
        expect(fit.footerTop - fit.lastNextBottom).toBeGreaterThanOrEqual(24);

        const boxes = await page.evaluate(() => {
          const plain = ({ left, top, right, bottom }) => ({ left, top, right, bottom });
          const lines = [];
          for (const root of document.querySelectorAll(".site-header, main")) {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
              if (!node.textContent.trim() || node.parentElement.closest("[data-lyra-globe]")) continue;
              const range = document.createRange();
              range.selectNodeContents(node);
              for (const rect of range.getClientRects()) {
                // Skip the closed menu, which has no box.
                if (rect.width > 0 && rect.height > 0) lines.push({ text: node.textContent.trim(), ...plain(rect) });
              }
            }
          }
          const labels = [...document.querySelectorAll("[data-lyra-globe] svg text")].map((el) => ({ text: el.textContent, ...plain(el.getBoundingClientRect()) }));
          const items = [...document.querySelectorAll(".hero__next-item")].map((el) => plain(el.getBoundingClientRect()));
          return { lines, labels, items };
        });

        const overlap = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
        expect(boxes.labels.length).toBeGreaterThan(0);
        expect(boxes.lines.length).toBeGreaterThan(0);
        for (const label of boxes.labels) {
          for (const line of boxes.lines) {
            expect(overlap(label, line), `"${line.text}" must not cover the globe label ${label.text}`).toBe(false);
          }
        }
        expect(boxes.items).toHaveLength(2);
        expect(overlap(boxes.items[0], boxes.items[1]), "the two rows must not overlap").toBe(false);
        // Intro text stays above the calls to action.
        for (const line of boxes.lines) {
          if (line.top >= boxes.items[0].top - 1) continue;
          for (const item of boxes.items) expect(overlap(line, item), `"${line.text}" must not run into a call to action`).toBe(false);
        }
      });

      test("starts the globe level with the eyebrow, balances it against the intro, and starts at the graphic box of the inner pages", async ({ page }) => {
        await page.goto("/");
        await settle(page);
        const read = await page.evaluate(() => {
          const box = document.querySelector(".lyra-globe").getBoundingClientRect();
          const canvas = document.querySelector(".lyra-globe__canvas").getBoundingClientRect();
          const header = document.querySelector(".site-header").getBoundingClientRect();
          const footer = document.querySelector(".site-footer").getBoundingClientRect();
          const eyebrow = document.querySelector(".hero .eyebrow").getBoundingClientRect();
          const main = document.querySelector(".hero__main").getBoundingClientRect();
          const list = document.querySelector(".hero__next").getBoundingClientRect();
          const rootStyle = getComputedStyle(document.documentElement);
          const frame = parseFloat(rootStyle.getPropertyValue("--frame"));
          const columnEdge = Math.max(0, (innerWidth - frame) / 2) + parseFloat(rootStyle.getPropertyValue("--reading-column"));
          return {
            width: box.width,
            top: box.top,
            eyebrowTop: eyebrow.top,
            left: box.left,
            expectedLeft: columnEdge + parseFloat(rootStyle.getPropertyValue("--graphic-gap")),
            viewport: innerWidth,
            centre: (box.top + box.bottom) / 2,
            introCentre: (main.top + list.bottom) / 2,
            clearOfFooter: footer.top - box.bottom,
            // The picture is drawn larger than the box, and the box crops it.
            zoom: canvas.width / box.width,
            eyebrowGap: eyebrow.top - header.bottom,
            listBottom: list.bottom,
            screen: window.innerHeight,
          };
        });
        expect(read.zoom, "the box crops the empty margin of the picture, so the sphere fills the box").toBeGreaterThanOrEqual(1.25);
        // Below 1280px the box shrinks with the room that is left of the graphic box, so the sphere stays whole.
        expect(read.width, "the globe uses the room beside the intro").toBeGreaterThanOrEqual(screen.width >= 1280 ? 440 : 260);
        expect(read.eyebrowGap, "the intro starts at the head room of the inner pages").toBe(72);
        expect(Math.abs(read.top - read.eyebrowTop), "the globe top is level with the eyebrow").toBeLessThanOrEqual(1);
        expect(read.clearOfFooter, "the globe bottom sits well above the footer bar").toBeGreaterThanOrEqual(48);
        expect(Math.abs(read.left - read.expectedLeft), "the globe box starts at the reading column edge plus the graphic gap").toBeLessThanOrEqual(1);
        expect(read.left, "the globe box starts inside the screen").toBeLessThan(read.viewport);
        // The intro uses the wide reading column, so it is shorter than it was in a narrow column.
        expect(Math.abs(read.centre - read.introCentre), "the globe centre stays near the intro centre").toBeLessThanOrEqual(100);
        expect(read.listBottom, "the intro stays on the screen").toBeLessThan(read.screen);
      });

      test("keeps the globe box clear of every line of text", async ({ page }) => {
        await page.goto("/");
        await settle(page);
        const { globeBox, lines } = await page.evaluate(() => {
          const plain = ({ left, top, right, bottom }) => ({ left, top, right, bottom });
          const lines = [];
          for (const root of document.querySelectorAll(".site-header, main, .site-footer")) {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
              if (!node.textContent.trim() || node.parentElement.closest("[data-lyra-globe]")) continue;
              const range = document.createRange();
              range.selectNodeContents(node);
              for (const rect of range.getClientRects()) {
                if (rect.width > 0 && rect.height > 0) lines.push({ text: node.textContent.trim(), ...plain(rect) });
              }
            }
          }
          return { globeBox: plain(document.querySelector("[data-lyra-globe]").getBoundingClientRect()), lines };
        });
        expect(lines.length).toBeGreaterThan(5);
        for (const line of lines) {
          const apart = line.right <= globeBox.left + 0.5 || line.left >= globeBox.right - 0.5
            || line.bottom <= globeBox.top + 0.5 || line.top >= globeBox.bottom - 0.5;
          expect(apart, `"${line.text}" must not sit under the globe`).toBe(true);
        }
      });

      test("draws no hairline across the header or the footer", async ({ page }) => {
        await page.goto("/");
        await settle(page);
        const style = await page.evaluate(() => ({
          headerShadow: getComputedStyle(document.querySelector(".site-header")).boxShadow,
          headerBorder: getComputedStyle(document.querySelector(".site-header")).borderBottomWidth,
          footerBorder: getComputedStyle(document.querySelector(".site-footer")).borderTopWidth,
          headerBottom: document.querySelector(".site-header").getBoundingClientRect().bottom,
          footerTop: document.querySelector(".site-footer").getBoundingClientRect().top,
          contentLeft: document.querySelector(".hero__main").getBoundingClientRect().left,
          width: document.documentElement.clientWidth,
        }));
        expect(style.headerShadow).toBe("none");
        expect(style.headerBorder).toBe("0px");
        expect(style.footerBorder).toBe("0px");

        // Compare the rows on each side of each seam, in columns between two
        // grid lines. A full-width line would show as a brighter row.
        const shot = await page.screenshot();
        const seams = await page.evaluate(async ({ base64, headerBottom, footerTop, contentLeft, width }) => {
          const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
          const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const context = canvas.getContext("2d");
          context.drawImage(bitmap, 0, 0);
          const { data, width: pixelWidth } = context.getImageData(0, 0, bitmap.width, bitmap.height);
          const green = (x, y) => data[(y * pixelWidth + x) * 4 + 1];
          // Columns in the middle of a grid cell, clear of the vertical lines.
          const columns = [];
          for (let x = 3; x < width - 3; x += 1) {
            const offset = (((x - contentLeft) % 40) + 40) % 40;
            if (offset > 8 && offset < 32 && x % 7 === 0) columns.push(x);
          }
          const spread = (seam) => {
            // A horizontal grid line sits at y = 39 + 40k. Leave those rows out.
            const rows = [seam - 1, seam, seam + 1].filter((row) => row % 40 !== 39);
            return Math.max(...columns.map((x) => Math.max(...rows.map((row) => green(x, row))) - Math.min(...rows.map((row) => green(x, row)))));
          };
          return { header: spread(Math.round(headerBottom)), footer: spread(Math.round(footerTop)) };
        }, { base64: shot.toString("base64"), headerBottom: style.headerBottom, footerTop: style.footerTop, contentLeft: style.contentLeft, width: style.width });
        expect(seams.header, "no line under the header").toBeLessThanOrEqual(1);
        expect(seams.footer, "no line over the footer").toBeLessThanOrEqual(1);
      });

      test("draws no horizontal grid line through the footer text", async ({ page }) => {
        await page.goto("/");
        await settle(page);
        const state = await page.evaluate(() => {
          const footer = document.querySelector(".site-footer").getBoundingClientRect();
          return {
            top: Math.round(footer.top), bottom: Math.round(footer.bottom),
            contentLeft: document.querySelector(".hero__main").getBoundingClientRect().left,
          };
        });
        const shot = await page.screenshot();
        const spread = await page.evaluate(async ({ base64, top, bottom, contentLeft }) => {
          const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
          const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const context = canvas.getContext("2d");
          context.drawImage(bitmap, 0, 0);
          const { data, width } = context.getImageData(0, 0, bitmap.width, bitmap.height);
          // Columns left of the text and clear of the vertical lines: only a
          // horizontal line can change a pixel in them.
          const columns = [];
          for (let x = 3; x < contentLeft - 4; x += 1) {
            const offset = (((x - contentLeft) % 40) + 40) % 40;
            if (offset > 8 && offset < 32) columns.push(x);
          }
          let widest = 0;
          for (const x of columns) {
            const values = [];
            for (let y = top + 1; y < bottom - 1; y += 1) values.push(data[(y * width + x) * 4 + 1]);
            widest = Math.max(widest, Math.max(...values) - Math.min(...values));
          }
          return { widest, columns: columns.length };
        }, { base64: shot.toString("base64"), ...state });
        expect(spread.columns).toBeGreaterThan(0);
        // A grid line would raise a row by 4 or more in the green channel.
        expect(spread.widest, "no horizontal line inside the footer bar").toBeLessThanOrEqual(1);
      });

      test("fades the grid: strong around the globe, gone behind the intro, the header, and the footer", async ({ page }) => {
        await page.goto("/");
        await settle(page);
        const grid = await readGrid(page);

        // The grid is there. Its strongest part sits at the globe, and a line
        // stands out from the ground by at least 3 levels of green.
        expect(grid.peak.contrast, "the grid shows somewhere").toBeGreaterThanOrEqual(3);
        const slack = 0.3;
        expect(grid.peak.x, "the strongest grid is at the globe").toBeGreaterThan(grid.globe.left - grid.globe.width * slack);
        expect(grid.peak.x).toBeLessThan(grid.globe.right + grid.globe.width * slack);
        expect(grid.peak.y).toBeGreaterThan(grid.globe.top - grid.globe.height * slack);
        expect(grid.peak.y).toBeLessThan(grid.globe.bottom + grid.globe.height * slack);

        // It is faded, not everywhere: at least half of the room has no grid line.
        expect(grid.quiet, "a large part of the screen holds no grid").toBeGreaterThanOrEqual(0.38);
        expect(grid.strong, "only a small part holds the grid at half strength").toBeLessThanOrEqual(0.3);

        // Behind the text and at the seams it is gone.
        expect(grid.intro, "no grid line behind the intro").toBeLessThanOrEqual(0.6);
        expect(grid.header, "no grid line behind the header").toBeLessThanOrEqual(0.6);
        expect(grid.footer, "no grid line behind the footer").toBeLessThanOrEqual(0.6);
        expect(grid.cards, "no grid line behind the calls to action").toBeLessThanOrEqual(1.5);
        expect(grid.below, "no grid line in the strip above the footer").toBeLessThanOrEqual(0.6);
        expect(grid.headerSeam, "no grid line at the seam under the header").toBeLessThanOrEqual(0.6);
      });

      test("shows no straight edge: the grid is gone at every edge of its layer and of the screen", async ({ page }) => {
        await page.goto("/");
        await settle(page);
        const edges = await readGridEdges(page);
        // The layer is real and holds lines, so the zero at its edges is a
        // property of the mask and not of a missing grid.
        expect(edges.layer.width).toBeGreaterThan(200);
        expect(edges.inside, "the layer holds visible grid lines").toBeGreaterThanOrEqual(5);
        for (const [side, largest] of Object.entries(edges.layerEdges)) {
          expect(largest, `no grid line reaches the ${side} edge of the layer`).toBeLessThanOrEqual(1);
        }
        for (const [side, largest] of Object.entries(edges.screenEdges)) {
          expect(largest, `no grid line reaches the ${side} edge of the screen`).toBeLessThanOrEqual(1);
        }
      });

      test("keeps one vertical grid line on the left edge of the content where the grid shows", async ({ page }) => {
        await page.goto("/");
        await settle(page);
        const grid = await readGrid(page);
        // Among the 40 columns of one tile, the line falls on the column of
        // the content edge, and on no other.
        expect(grid.peak.contrast).toBeGreaterThanOrEqual(3);
        expect(grid.lineOffset, "the lines sit 0px from the content edge, modulo 40").toBe(0);
      });
    });
  }
});

test.describe("the globe band below 1100px", () => {
  for (const screen of BAND_SCREENS) {
    test.describe(`${screen.width}x${screen.height}`, () => {
      test.use({ viewport: screen });

      test("holds a canvas that fills the band, and shows Vega and its name whole inside it", async ({ page }) => {
        await page.goto("/");
        await settle(page);
        await expect(page.locator(globe)).toHaveAttribute("data-ready", "true");
        const read = await page.evaluate(() => {
          const plain = ({ left, top, right, bottom, width, height }) => ({ left, top, right, bottom, width, height });
          const band = document.querySelector(".hero__globe").getBoundingClientRect();
          const root = document.querySelector("[data-lyra-globe]").getBoundingClientRect();
          const canvas = document.querySelector(".lyra-globe__canvas").getBoundingClientRect();
          const labels = [...document.querySelectorAll("[data-lyra-globe] svg text")]
            .filter((text) => getComputedStyle(text).display !== "none")
            .map((text) => ({ text: text.textContent, ...plain(text.getBoundingClientRect()), size: parseFloat(getComputedStyle(text).fontSize) }));
          return { band: plain(band), root: plain(root), canvas: plain(canvas), labels, main: document.querySelector(".hero__main").getBoundingClientRect().top };
        });

        // The globe box is the band, and the intro starts under it.
        expect(read.root.width).toBeCloseTo(read.band.width, 0);
        expect(read.root.height).toBeCloseTo(read.band.height, 0);
        expect(read.band.bottom).toBeLessThanOrEqual(read.main + 0.5);
        // The canvas fills the band across its whole width, and the band crops it: the picture
        // is larger than the band.
        expect(read.canvas.left, "the canvas reaches the left edge of the band").toBeLessThanOrEqual(read.band.left + 0.5);
        expect(read.canvas.right, "the canvas reaches the right edge of the band").toBeGreaterThanOrEqual(read.band.right - 0.5);
        expect(read.canvas.width, "the picture is larger than the band").toBeGreaterThan(read.band.width);
        expect(read.canvas.height, "the picture is taller than the band").toBeGreaterThan(read.band.height);
        // Vega and its name sit whole inside the band, clear of the 24px edge fade.
        const vega = read.labels.find((label) => label.text === "VEGA");
        expect(vega, "the Vega label shows").toBeTruthy();
        expect(vega.size, "the label keeps a readable size").toBeGreaterThanOrEqual(10);
        expect(vega.left, "Vega's name clears the left fade").toBeGreaterThanOrEqual(read.band.left + 24);
        expect(vega.right, "Vega's name clears the right fade").toBeLessThanOrEqual(read.band.right - 24);
        expect(vega.top, "Vega's name clears the top fade").toBeGreaterThanOrEqual(read.band.top + 24);
        expect(vega.bottom, "Vega's name clears the bottom fade").toBeLessThanOrEqual(read.band.bottom - 24);
        for (const label of read.labels) {
          expect(label.left).toBeGreaterThanOrEqual(read.band.left);
          expect(label.right).toBeLessThanOrEqual(read.band.right);
          expect(label.top).toBeGreaterThanOrEqual(read.band.top);
          expect(label.bottom).toBeLessThanOrEqual(read.band.bottom);
        }
      });

      test("puts the Vega label in the same place with and without the canvas", async ({ browser, baseURL, page }) => {
        await useReducedMotion(page);
        await page.goto("/");
        await settle(page);
        await expect(page.locator(globe)).toHaveAttribute("data-motion-state", "still");
        // The label sits at a fixed offset from the Vega star, so the label place shows the star place.
        const star = (target) => target.evaluate(() => {
          const band = document.querySelector(".hero__globe").getBoundingClientRect();
          const label = [...document.querySelectorAll("[data-lyra-globe] svg text")].find((text) => text.textContent === "VEGA").getBoundingClientRect();
          return { x: label.left - band.left, y: label.top - band.top, width: band.width, height: band.height };
        });
        const withCanvas = await star(page.locator("body"));
        const plain = await browser.newContext({ javaScriptEnabled: false, viewport: screen });
        const plainPage = await plain.newPage();
        await plainPage.goto(new URL("/", baseURL).href);
        await settle(plainPage);
        const withoutCanvas = await star(plainPage.locator("body"));
        await plain.close();
        expect(Math.abs(withoutCanvas.x - withCanvas.x), "the label x").toBeLessThanOrEqual(1);
        expect(Math.abs(withoutCanvas.y - withCanvas.y), "the label y").toBeLessThanOrEqual(1);
        expect(withoutCanvas.width).toBeCloseTo(withCanvas.width, 0);
        expect(withoutCanvas.height).toBeCloseTo(withCanvas.height, 0);
      });

      test("draws no grid layer behind the band, as the inner pages draw none", async ({ page }) => {
        await page.goto("/");
        await settle(page);
        const layers = await page.evaluate(() => ["::before", "::after"].map((pseudo) => getComputedStyle(document.querySelector(".hero__globe"), pseudo).display));
        expect(layers).toEqual(["none", "none"]);
      });

      test("keeps the calls to action clear of the footer and the header with the page at the end", async ({ page }) => {
        await page.goto("/");
        await settle(page);
        await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
        const end = await page.evaluate(() => ({
          footerTop: document.querySelector(".site-footer").getBoundingClientRect().top,
          nextBottom: Math.max(...[...document.querySelectorAll(".hero__next-item")].map((item) => item.getBoundingClientRect().bottom)),
          overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          scrollY: window.scrollY,
          header: getComputedStyle(document.querySelector(".site-header")).position,
          headerHeight: document.querySelector(".site-header").getBoundingClientRect().height,
          headerBottom: document.querySelector(".site-header").getBoundingClientRect().bottom,
          headerBackground: getComputedStyle(document.querySelector(".site-header")).backgroundColor,
          fade: getComputedStyle(document.querySelector(".site-footer"), "::before").display,
        }));
        expect(end.footerTop - end.nextBottom, "the calls to action stay 24px above the footer").toBeGreaterThanOrEqual(24);
        expect(end.overflowX).toBeLessThanOrEqual(1);
        expect(end.fade, "the footer fade shows, as on the inner pages").not.toBe("none");
        // The header is not sticky and has no ground of its own, so it moves up with the page.
        expect(end.header).toBe("relative");
        expect(end.headerBackground).toBe("rgba(0, 0, 0, 0)");
        expect(Math.abs(end.headerBottom - (end.headerHeight - end.scrollY)), "the header scrolls with the page").toBeLessThanOrEqual(1);
      });
    });
  }

  test("shows the calls to action without scrolling on every band screen", async ({ page }) => {
    for (const screen of BAND_SCREENS) {
      await page.setViewportSize(screen);
      await page.goto("/");
      await settle(page);
      const fit = await page.evaluate(() => ({
        scrollHeight: document.documentElement.scrollHeight,
        innerHeight: window.innerHeight,
        footerTop: document.querySelector(".site-footer").getBoundingClientRect().top,
        nextBottom: Math.max(...[...document.querySelectorAll(".hero__next-item")].map((item) => item.getBoundingClientRect().bottom)),
      }));
      expect(fit.scrollHeight, `${screen.width}x${screen.height} needs no scroll`).toBeLessThanOrEqual(fit.innerHeight);
      expect(fit.footerTop - fit.nextBottom).toBeGreaterThanOrEqual(24);
    }
  });
});

/** The left edge of the first text in an element, and its style as the browser computes it. */
const readEyebrow = (page, selector) => page.locator(selector).evaluate((eyebrow) => {
  const walker = document.createTreeWalker(eyebrow, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node && !node.textContent.trim()) node = walker.nextNode();
  const range = document.createRange();
  range.selectNodeContents(node);
  const style = getComputedStyle(eyebrow);
  const dash = getComputedStyle(eyebrow, "::before");
  return {
    textLeft: range.getBoundingClientRect().left,
    color: style.color,
    weight: style.fontWeight,
    letterSpacing: style.letterSpacing,
    dashWidth: dash.width,
    dashHeight: dash.height,
    dashGap: dash.marginRight,
  };
});

test.describe("the home eyebrow matches the About eyebrow", () => {
  for (const viewport of [VIEWPORTS.desktop, VIEWPORTS.mobile]) {
    test(`in text position, colour, weight, tracking, and dash at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/about/");
      await settle(page);
      const about = await readEyebrow(page, ".about .eyebrow");
      await page.goto("/");
      await settle(page);
      const home = await readEyebrow(page, ".hero .eyebrow");
      expect(Math.abs(home.textLeft - about.textLeft), "the text starts at the same x").toBeLessThanOrEqual(0.5);
      expect(home.color).toBe(about.color);
      expect(home.weight).toBe(about.weight);
      expect(home.letterSpacing).toBe(about.letterSpacing);
      expect([home.dashWidth, home.dashHeight, home.dashGap]).toEqual([about.dashWidth, about.dashHeight, about.dashGap]);
    });
  }
});

test.describe("the intro on a tablet uses the reading column", () => {
  for (const viewport of [{ width: 1024, height: 768 }, { width: 820, height: 1180 }]) {
    test(`fills the reading column, as the inner pages do, at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/");
      await settle(page);
      const widths = await page.evaluate(() => {
        const column = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--reading-column"));
        const pad = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--frame-pad"));
        return {
          text: column - 2 * pad,
          thesis: document.querySelector(".hero__thesis").getBoundingClientRect().width,
          next: document.querySelector(".hero__next").getBoundingClientRect().width,
        };
      });
      expect(widths.text).toBe(680);
      expect(Math.abs(widths.thesis - widths.text)).toBeLessThanOrEqual(1);
      expect(Math.abs(widths.next - widths.text)).toBeLessThanOrEqual(1);
    });
  }
});

test.describe("the intro on the shortest phone", () => {
  test.use({ viewport: WIDTHS.narrow });

  test("keeps a gap under the name, open lines, no widow, and even rows", async ({ page }) => {
    await page.goto("/");
    await settle(page);
    const read = await page.evaluate(() => {
      const box = (selector) => document.querySelector(selector).getBoundingClientRect();
      const lineRatio = (selector) => {
        const style = getComputedStyle(document.querySelector(selector));
        return parseFloat(style.lineHeight) / parseFloat(style.fontSize);
      };
      // Group the words of the thesis by line, and count the words on the last line.
      const thesis = document.querySelector(".hero__thesis");
      const walker = document.createTreeWalker(thesis, NodeFilter.SHOW_TEXT);
      const tops = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (const match of node.textContent.matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          tops.push(Math.round(range.getBoundingClientRect().top));
        }
      }
      const rowText = document.querySelector(".hero__next-item").firstElementChild ?? document.querySelector(".hero__next-item");
      const textRange = document.createRange();
      textRange.selectNodeContents(rowText);
      return {
        nameToLede: box(".hero__lede").top - box("h1").bottom,
        ledeToThesis: box(".hero__thesis").top - box(".hero__lede").bottom,
        ledeLine: lineRatio(".hero__lede"),
        thesisLine: lineRatio(".hero__thesis"),
        lastLineWords: tops.filter((top) => top === tops[tops.length - 1]).length,
        thesisToRule: box(".hero__next").top - box(".hero__thesis").bottom,
        ruleToText: textRange.getBoundingClientRect().top - box(".hero__next").top,
        rowsGap: box(".hero__next-item:last-child").top - box(".hero__next-item:first-child").bottom,
        wrap: [getComputedStyle(document.querySelector(".hero__lede")).textWrapStyle, getComputedStyle(thesis).textWrapStyle],
        footerGap: box(".site-footer").top - box(".hero__next-item:last-child").bottom,
        scroll: document.documentElement.scrollHeight - innerHeight,
      };
    });
    expect(read.nameToLede, "the name clears the lede").toBeGreaterThanOrEqual(4);
    expect(read.ledeToThesis, "the lede clears the thesis").toBeGreaterThanOrEqual(10);
    expect(read.ledeLine).toBeGreaterThanOrEqual(1.35);
    expect(read.thesisLine).toBeGreaterThanOrEqual(1.35);
    expect(read.lastLineWords, "the thesis does not end on a widow").toBeGreaterThanOrEqual(2);
    expect(read.thesisToRule, "the thesis clears the hairline").toBeGreaterThanOrEqual(12);
    expect(read.ruleToText, "the hairline clears the first row text").toBeGreaterThanOrEqual(12);
    expect(read.rowsGap, "the rows sit one under the other with no overlap").toBeGreaterThanOrEqual(0);
    expect(read.wrap).toEqual(["pretty", "pretty"]);
    expect(read.footerGap).toBeGreaterThanOrEqual(24);
    expect(read.scroll).toBeLessThanOrEqual(0);
  });
});

test.describe("the live call to action focus ring", () => {
  test.use({ viewport: VIEWPORTS.desktop });

  test("keeps the text on the column edge and surrounds text and arrow evenly", async ({ page }) => {
    await page.goto(dev + "/");
    await settle(page);
    expect(await tabTo(page, ".hero__next a[href='/writing/']")).toBe(true);
    const read = await page.evaluate(() => {
      const link = document.activeElement;
      const style = getComputedStyle(link);
      const box = link.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(link);
      const text = range.getBoundingClientRect();
      // The arrow slides 5px on focus. Read it where the layout puts it, not where the slide has
      // brought it after some milliseconds, which depends on how fast the machine runs.
      const slide = new DOMMatrix(getComputedStyle(link.querySelector(".hero__next-arrow")).transform).m41;
      const width = parseFloat(style.outlineWidth);
      const offset = parseFloat(style.outlineOffset);
      const list = document.querySelector(".hero__next").getBoundingClientRect();
      // The ring is drawn from `offset` outside the box. Its inner edge is `offset` from the box edge.
      return {
        listLeft: list.left,
        textLeft: text.left,
        ringOuterLeft: box.left - offset - width,
        leftGap: text.left - (box.left - offset),
        rightGap: (box.right + offset) - (text.right - slide),
        height: box.height,
      };
    });
    expect(Math.abs(read.textLeft - read.listLeft), "the text starts on the column edge").toBeLessThanOrEqual(0.5);
    expect(Math.abs(read.leftGap - read.rightGap), "the ring surrounds text and arrow evenly").toBeLessThanOrEqual(1);
    expect(read.leftGap, "the ring keeps clear of the text").toBeGreaterThanOrEqual(4);
    expect(read.listLeft - read.ringOuterLeft, "the ring hangs no more than 10px left of the column").toBeLessThanOrEqual(10.5);
    expect(read.height).toBeGreaterThanOrEqual(44);
  });
});
