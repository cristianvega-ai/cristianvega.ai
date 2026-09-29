import { expect, test } from "@playwright/test";

import { settle, tabTo, useReducedMotion, VIEWPORTS } from "./fixtures.mjs";

/**
 * The homepage: one screen with the intro, the Lyra globe, and two cards for
 * Writing and Products. A card links only when its section has visible
 * content. Production comes from the built site on the base URL, where both
 * cards say "Coming soon". The dev server holds the drafts, so both link.
 */

const dev = "http://127.0.0.1:4324";
const globe = "[data-lyra-globe]";
const WIDTHS = { ...VIEWPORTS, wide: { width: 1920, height: 1080 }, narrow: { width: 360, height: 740 } };
/** The screens where the homepage must fit with no scrolling. */
const SCREENS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 820, height: 1180 },
  { width: 390, height: 844 },
  { width: 360, height: 740 },
];

/**
 * Replace requestAnimationFrame with a manual clock. A frame runs only when a
 * test calls `window.__step(time)`, so the entrance stays in flight until the
 * test says otherwise, and `window.__pending()` counts the frames left queued.
 */
async function useManualFrames(page) {
  await page.addInitScript(() => {
    let next = 0;
    const queue = new Map();
    window.requestAnimationFrame = (callback) => {
      next += 1;
      queue.set(next, callback);
      return next;
    };
    window.cancelAnimationFrame = (id) => {
      queue.delete(id);
    };
    window.__pending = () => queue.size;
    window.__step = (time) => {
      const callbacks = [...queue.values()];
      queue.clear();
      for (const callback of callbacks) callback(time);
    };
  });
}

const pending = (page) => page.evaluate(() => window.__pending());

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
    await expect(page.getByRole("link", { name: "More about me →" })).toHaveAttribute("href", "/about/");
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

/** The picture of a visitor without JavaScript: the SVG in the noscript. */
async function readPlainGlobe(browser, baseURL, viewport) {
  const plain = await browser.newContext({ javaScriptEnabled: false, viewport });
  const plainPage = await plain.newPage();
  await plainPage.goto(new URL("/", baseURL).href);
  await settle(plainPage);
  const shot = await plainPage.locator(globe).screenshot();
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

    const look = async () => (await measureLight(page, await page.locator(globe).screenshot())).means[0];
    // The grid lines behind the box hold some light too. Read them alone, with
    // the canvas and the labels hidden, so the frames are measured above them.
    const layers = page.locator(`${globe} canvas, ${globe} .lyra-globe__labels`);
    await layers.evaluateAll((list) => list.forEach((layer) => { layer.style.visibility = "hidden"; }));
    const empty = await look();
    await layers.evaluateAll((list) => list.forEach((layer) => { layer.style.visibility = ""; }));
    const levels = [await look()];
    await page.evaluate(() => window.__step(1));
    for (const time of [301, 601, 901, 1201, 1501, 1801, 2101]) {
      await page.evaluate((value) => window.__step(value), time);
      levels.push(await look());
    }
    await page.evaluate(() => window.__step(9000));
    await expect(page.locator(globe)).toHaveAttribute("data-motion-state", "still");
    // The labels fade in on a CSS clock of their own. Wait for it before the last look.
    await settle(page);
    const last = await page.locator(globe).screenshot();
    const [final] = (await measureLight(page, last)).means;
    const match = await measureLight(page, plain, last);

    // How much of the finished picture each frame holds, from 0 to 1.
    const share = levels.map((level) => (level - empty) / (full - empty));
    expect(share[0], "the first frame is nearly empty").toBeLessThan(0.05);
    expect(share[3], "the middle of the entrance holds part of the picture").toBeGreaterThan(0.2);
    expect(share[3], "the middle of the entrance is not yet complete").toBeLessThan(0.9);
    for (let i = 1; i < 6; i += 1) expect(share[i], `frame ${i} adds to frame ${i - 1}`).toBeGreaterThanOrEqual(share[i - 1] - 0.02);
    // The last frame is the finished picture: it matches the SVG closely.
    expect(Math.abs(final - full) / full, "the final light matches the SVG").toBeLessThan(0.03);
    expect(match.diff, "the final frame matches the SVG mark for mark").toBeLessThan(0.3);
  });

  test("reduced motion paints the finished picture on the first frame", async ({ browser, baseURL, page }) => {
    const plain = await readPlainGlobe(browser, baseURL, VIEWPORTS.desktop);
    await useManualFrames(page);
    await useReducedMotion(page);
    await page.goto("/");
    await expect(page.locator(globe)).toHaveAttribute("data-ready", "true");
    await expect(page.locator(globe)).toHaveAttribute("data-motion-state", "still");
    expect(await pending(page)).toBe(0);
    await settle(page);

    const shown = await page.locator(globe).screenshot();
    const match = await measureLight(page, plain, shown);
    expect(Math.abs(match.means[1] - match.means[0]) / match.means[0], "the light matches the SVG").toBeLessThan(0.03);
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
    expect(await pending(page)).toBe(0);
  });

  test("runs to the end when its frames run, then queues no more", async ({ page }) => {
    await useManualFrames(page);
    await page.goto("/");
    await expect(page.locator(globe)).toHaveAttribute("data-motion-state", "playing");
    expect(await pending(page)).toBe(1);

    await page.evaluate(() => window.__step(1000));
    await expect(page.locator(globe)).toHaveAttribute("data-motion-state", "playing");
    await page.evaluate(() => window.__step(9000));
    await expect(page.locator(globe)).toHaveAttribute("data-motion-state", "still");
    expect(await pending(page)).toBe(0);
  });

  test("stops its frames while the tab is hidden and resumes when it returns", async ({ page }) => {
    await useManualFrames(page);
    await page.goto("/");
    await expect(page.locator(globe)).toHaveAttribute("data-motion-state", "playing");
    expect(await pending(page)).toBe(1);

    const setHidden = (hidden) =>
      page.evaluate((value) => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => value });
        document.dispatchEvent(new Event("visibilitychange"));
      }, hidden);

    await setHidden(true);
    expect(await pending(page)).toBe(0);
    await setHidden(false);
    expect(await pending(page)).toBe(1);
  });

  test("cancels its frames on pagehide and starts again on a restored page", async ({ page }) => {
    await useManualFrames(page);
    await page.goto("/");
    await expect(page.locator(globe)).toHaveAttribute("data-motion-state", "playing");
    expect(await pending(page)).toBe(1);

    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
    expect(await pending(page)).toBe(0);
    await expect(page.locator(globe)).not.toHaveAttribute("data-ready", /.*/);
    await expect(page.locator(globe)).not.toHaveAttribute("data-motion-state", /.*/);
    await expect(page.locator(`${globe} .lyra-globe__fallback`)).toHaveCount(0);

    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    await expect(page.locator(globe)).toHaveAttribute("data-ready", "true");
    await expect(page.locator(globe)).toHaveAttribute("data-motion-state", "playing");
    await expect.poll(() => pending(page)).toBe(1);
  });

  test("pauses while the globe is off-screen and resumes when it returns", async ({ page }) => {
    await useManualFrames(page);
    await page.goto(dev + "/");
    await expect(page.locator(globe)).toHaveAttribute("data-motion-state", "playing");
    await expect.poll(() => pending(page)).toBe(1);

    // The homepage fits one screen and does not scroll. Add a tall block below
    // it so the globe can leave the screen.
    await page.evaluate(() => {
      const spacer = document.createElement("div");
      spacer.style.height = "3000px";
      document.querySelector("#main-content").after(spacer);
    });

    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
    await expect.poll(() => pending(page)).toBe(0);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await expect.poll(() => pending(page)).toBe(1);
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
      // A short phone leaves the globe the least room. It keeps a 260px floor.
      expect(layout.art.width).toBeGreaterThanOrEqual(viewport.width < 900 ? 260 : 400);
      if (viewport.width > 900) {
        // Side by side: the globe sits to the right of the intro.
        expect(layout.art.left).toBeGreaterThanOrEqual(layout.main.right - 0.5);
      }
      if (viewport.width > 900) {
        expect(layout.art.right).toBeLessThanOrEqual(layout.width + 0.5);
      } else {
        // Stacked: the globe sits under the intro, inside the screen.
        expect(layout.art.top).toBeGreaterThanOrEqual(layout.main.bottom - 0.5);
        expect(layout.art.left).toBeGreaterThanOrEqual(0);
        expect(layout.art.right).toBeLessThanOrEqual(layout.width + 0.5);
      }
    });

    test("lists no writing or products and shows two Coming soon cards in production", async ({ page, request }) => {
      await page.goto("/");
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.locator("main h2")).toHaveCount(0);
      await expect(page.locator("[data-post-id], [data-product-id]")).toHaveCount(0);
      await expect(page.locator(".nav__link[href='/products/'], .nav-menu__link[href='/products/']")).toHaveCount(0);
      await expect(page.locator(".nav__link[href='/writing/'], .nav-menu__link[href='/writing/']")).toHaveCount(0);
      // No link on the page may point at a route that is not built.
      await expect(page.locator("a[href^='/writing'], a[href^='/products'], a[href='#']")).toHaveCount(0);

      const cards = page.locator(".paths .path");
      await expect(cards).toHaveCount(2);
      await expect(cards.locator("xpath=self::a")).toHaveCount(0);
      expect(await cards.evaluateAll((nodes) => nodes.map((node) => node.dataset.state))).toEqual(["soon", "soon"]);
      await expect(cards.nth(0)).toContainText("Writing");
      await expect(cards.nth(0)).toContainText("Notes on production AI, engineering, and the systems around them.");
      await expect(cards.nth(1)).toContainText("Products");
      await expect(cards.locator(".path__status")).toHaveText(["Coming soon", "Coming soon"]);

      // A card that is not a link takes no keyboard focus and no click.
      const focusable = await page.locator(".paths").evaluate((list) => list.querySelectorAll("a, button, [tabindex]").length);
      expect(focusable).toBe(0);
      expect((await request.get("/products/")).status()).toBe(404);
      expect((await request.get("/products/opencatalyst/")).status()).toBe(404);
      expect((await request.get("/writing/")).status()).toBe(404);
    });

    test("shows two linked cards and no lists with the drafts on the dev server", async ({ page }) => {
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
      await page.goto(dev + "/");
      await settle(page);

      // The Astro dev toolbar adds its own headings, so scope to main.
      await expect(page.locator("main h1")).toHaveCount(1);
      await expect(page.locator("main h2")).toHaveCount(0);
      await expect(page.locator("[data-post-id], [data-product-id]")).toHaveCount(0);

      const cards = page.locator(".paths a.path");
      await expect(cards).toHaveCount(2);
      await expect(cards.nth(0)).toHaveAttribute("href", "/writing/");
      await expect(cards.nth(1)).toHaveAttribute("href", "/products/");
      expect(await cards.evaluateAll((nodes) => nodes.map((node) => node.dataset.state))).toEqual(["live", "live"]);
      await expect(page.locator(".paths")).not.toContainText("Coming soon");
      await expect(page.getByRole("link", { name: /^Writing\b.*Notes on production AI/ })).toHaveCount(1);
      await expect(page.getByRole("link", { name: /^Products\b/ })).toHaveCount(1);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      expect(errors).toEqual([]);
    });
  });
}

test.describe("products on the dev server", () => {
  test.use({ viewport: VIEWPORTS.desktop });

  test("the index and the detail page read like the article pages", async ({ page }) => {
    await page.goto(dev + "/products/");
    await expect(page.locator("main h1")).toHaveText("Products");
    await expect(page.locator(".nav__link[href='/products/']")).toHaveAttribute("aria-current", "page");
    await expect(page.locator("meta[name='robots']")).toHaveAttribute("content", "noindex, follow");
    await expect(page.locator("meta[name='color-scheme']")).toHaveAttribute("content", "dark");
    await page.getByRole("link", { name: "OpenCatalyst" }).click();

    await expect(page).toHaveURL(dev + "/products/opencatalyst/");
    await expect(page.locator("main h1")).toHaveText("OpenCatalyst");
    await expect(page.locator(".nav__link[href='/products/']")).toHaveAttribute("aria-current", "location");
    await expect(page.locator("meta[name='robots']")).toHaveAttribute("content", "noindex, follow");
    await expect(page.locator(".product__prose")).toContainText("60K lines of Rust and TypeScript");
    await expect(page.getByRole("link", { name: "All products →" })).toHaveAttribute("href", "/products/");
    // A draft with no address shows no outbound link.
    await expect(page.locator(".product__link[target='_blank']")).toHaveCount(0);
  });

  test("an unknown product is a 404", async ({ request }) => {
    expect((await request.get(dev + "/products/no-such-product/")).status()).toBe(404);
  });

  test("the reading edge matches the about page at every width", async ({ page }) => {
    for (const viewport of Object.values(WIDTHS)) {
      await page.setViewportSize(viewport);
      const edges = [];
      for (const url of [dev + "/products/", "/about/"]) {
        await page.goto(url);
        await settle(page);
        edges.push(await page.locator("main .wrap--read").first().evaluate((el) => {
          const rect = el.getBoundingClientRect();
          return Math.round(rect.left + parseFloat(getComputedStyle(el).paddingLeft));
        }));
      }
      expect(edges[0], `at ${viewport.width}px`).toBe(edges[1]);
    }
  });
});

for (const viewport of [VIEWPORTS.desktop, VIEWPORTS.mobile, WIDTHS.narrow]) {
  test(`the home eyebrow keeps both clauses on one line, clear of the header, at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await settle(page);
    const state = await page.locator(".hero__eyebrow").evaluate((eyebrow) => {
      const [first, second] = [...eyebrow.querySelectorAll(".eyebrow__part")].map((part) => part.getBoundingClientRect());
      return {
        box: eyebrow.getBoundingClientRect().toJSON(), first, second, text: eyebrow.textContent,
        headerBottom: document.querySelector(".site-header").getBoundingClientRect().bottom,
        fontSize: parseFloat(getComputedStyle(eyebrow).fontSize),
        toName: document.querySelector("h1").getBoundingClientRect().top - eyebrow.getBoundingClientRect().bottom,
        ledeToThesis: document.querySelector(".hero__thesis").getBoundingClientRect().top - document.querySelector(".hero__lede").getBoundingClientRect().bottom,
        thesisToMore: document.querySelector(".hero__more").getBoundingClientRect().top - document.querySelector(".hero__thesis").getBoundingClientRect().bottom,
      };
    });
    expect(state.text.replace(/\s+/g, " ").trim()).toBe("AI Engineering Leader Agentic Systems");
    // One line: the second clause starts after the first ends, on the same row.
    expect(state.second.top).toBeLessThan(state.first.bottom - 1);
    expect(state.second.left).toBeGreaterThanOrEqual(state.first.right - 1);
    expect(state.fontSize).toBeGreaterThanOrEqual(10);
    // The intro keeps a steady rhythm on a phone. A tall phone has room and
    // gets the larger set. A short phone gets the tight set, which still keeps
    // the gaps clear of the crowded 5px to 8px of the old intro.
    if (viewport.width < 540) {
      const tall = viewport.height >= 800;
      expect(state.box.top - state.headerBottom, "the eyebrow clears the header").toBeGreaterThanOrEqual(tall ? 24 : 12);
      expect(state.toName, "the eyebrow clears the name").toBeGreaterThanOrEqual(tall ? 14 : 10);
      expect(state.ledeToThesis, "the lede clears the thesis").toBeGreaterThanOrEqual(tall ? 14 : 8);
      expect(state.thesisToMore, "the thesis clears the link").toBeGreaterThanOrEqual(tall ? 2 : 0);
    }
  });
}

/** Read the box of each card and of the parts inside it. */
const readCards = (page) => page.evaluate(() => [...document.querySelectorAll(".paths .path")].map((card) => {
  const box = card.getBoundingClientRect();
  const part = (selector) => card.querySelector(selector).getBoundingClientRect();
  return {
    top: box.top, height: box.height, left: box.left, right: box.right,
    title: part(".path__title").top - box.top,
    statusTop: part(".path__status").top - box.top,
    statusRight: box.right - part(".path__status").right,
    statusHeight: part(".path__status").height,
    hasLine: Boolean(card.querySelector(".path__line")),
    // The room between the title row and the description.
    lineGap: card.querySelector(".path__line")
      ? part(".path__line").top - Math.max(part(".path__title").bottom, part(".path__status").bottom)
      : null,
    titleBaseline: part(".path__title").bottom - box.top,
    // The room above and below the content, so a test can see how it is centred.
    gapTop: Math.min(...[...card.children].map((child) => child.getBoundingClientRect().top)) - box.top,
    gapBottom: box.bottom - Math.max(...[...card.children].map((child) => child.getBoundingClientRect().bottom)),
  };
}));

for (const [name, origin] of [["production", ""], ["dev", dev]]) {
  test.describe(`the two cards share one structure in ${name}`, () => {
    for (const viewport of [VIEWPORTS.desktop, VIEWPORTS.tablet, VIEWPORTS.mobile, WIDTHS.narrow]) {
      test(`match in height and line up their rows at ${viewport.width}px`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.goto(origin + "/");
        await settle(page);
        const rows = await readCards(page);
        expect(rows).toHaveLength(2);
        expect(Math.abs(rows[0].height - rows[1].height)).toBeLessThanOrEqual(1);
        expect(Math.abs(rows[0].statusHeight - rows[1].statusHeight)).toBeLessThanOrEqual(1);
        expect(Math.abs(rows[0].statusRight - rows[1].statusRight)).toBeLessThanOrEqual(1);
        // Side by side at every width, phones included: the cards start on one
        // row, share one height, and do not overlap.
        expect(Math.abs(rows[0].top - rows[1].top)).toBeLessThanOrEqual(1);
        expect(rows[1].left, "the cards sit side by side").toBeGreaterThanOrEqual(rows[0].right);
        // Both titles sit on one baseline, measured from the top of each card,
        // and both status pills sit at one height. The Products card keeps an
        // empty description row, so its title does not drift to the middle.
        expect(Math.abs(rows[0].titleBaseline - rows[1].titleBaseline), "the titles share a baseline").toBeLessThanOrEqual(1);
        expect(Math.abs(rows[0].title - rows[1].title), "the titles share a top").toBeLessThanOrEqual(1);
        expect(Math.abs(rows[0].statusTop - rows[1].statusTop), "the status pills line up").toBeLessThanOrEqual(1);
        // The padding is even: the room above the title row equals the room
        // below the description, and it is never the cramped 7px of the old card.
        expect(Math.abs(rows[0].gapTop - rows[0].gapBottom), "the padding is even").toBeLessThanOrEqual(2);
        expect(rows[0].gapTop, "the title row has room above it").toBeGreaterThanOrEqual(viewport.width > 600 ? 16 : 10);
        expect(rows[0].lineGap, "the description does not touch the title row").toBeGreaterThanOrEqual(3);
        // The owner has not supplied a Products line. Writing has one.
        expect(rows.map((row) => row.hasLine)).toEqual([true, false]);
      });

      test(`keep one height when Products gains a line, at ${viewport.width}px`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.goto(origin + "/");
        await settle(page);
        // Add the line the owner may supply later, to the second card.
        await page.evaluate(() => {
          const card = document.querySelectorAll(".paths .path")[1];
          const line = document.createElement("span");
          line.className = "path__line";
          line.textContent = "A hypothetical line for the products, long enough to wrap onto a second row on a phone.";
          card.querySelector(".path__status").before(line);
        });
        const rows = await readCards(page);
        expect(Math.abs(rows[0].height - rows[1].height)).toBeLessThanOrEqual(1);
        expect(Math.abs(rows[0].title - rows[1].title)).toBeLessThanOrEqual(1);
        expect(Math.abs(rows[0].statusTop - rows[1].statusTop)).toBeLessThanOrEqual(1);
        expect(Math.abs(rows[0].statusRight - rows[1].statusRight)).toBeLessThanOrEqual(1);
      });
    }
  });
}

for (const [name, origin] of [["production", ""], ["dev", dev]]) {
  test.describe(`the cards on a phone in ${name}`, () => {
    for (const viewport of [VIEWPORTS.mobile, WIDTHS.narrow]) {
      test(`sit side by side, stay compact, and cut no word at ${viewport.width}px`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.goto(origin + "/");
        await settle(page);
        const read = await page.evaluate(() => {
          const plain = (el) => {
            const { left, top, right, bottom, width, height } = el.getBoundingClientRect();
            return { left, top, right, bottom, width, height };
          };
          return {
            client: document.documentElement.clientWidth,
            cards: [...document.querySelectorAll(".paths .path")].map((card) => ({
              box: plain(card),
              parts: [".path__title", ".path__status", ".path__line"].map((selector) => {
                const part = card.querySelector(selector);
                return part && {
                  selector, box: plain(part), clipped: part.scrollWidth > part.clientWidth,
                  fontSize: parseFloat(getComputedStyle(part).fontSize),
                  overflow: getComputedStyle(part).textOverflow,
                };
              }).filter(Boolean),
              titleBottom: card.querySelector(".path__title").getBoundingClientRect().bottom,
              statusTop: card.querySelector(".path__status").getBoundingClientRect().top,
            })),
          };
        });
        expect(read.cards).toHaveLength(2);
        const [first, second] = read.cards;
        // Two columns, one row, one gutter of 10px.
        expect(Math.abs(first.box.top - second.box.top)).toBeLessThanOrEqual(1);
        expect(second.box.left - first.box.right, "the gutter between the cards").toBeGreaterThanOrEqual(8);
        expect(second.box.left - first.box.right).toBeLessThanOrEqual(12);
        expect(Math.abs(first.box.width - second.box.width)).toBeLessThanOrEqual(1);
        expect(first.box.left).toBeGreaterThanOrEqual(19);
        expect(second.box.right).toBeLessThanOrEqual(read.client - 19);
        // Compact and still a comfortable target: at least 44px tall, and the
        // pair no taller than 130px. The old stack took 190px or more.
        for (const card of read.cards) {
          expect(card.box.height, "a comfortable target").toBeGreaterThanOrEqual(44);
          expect(card.box.height, "compact").toBeLessThanOrEqual(130);
          // The status sits under the title: the card is too narrow for both on one row.
          expect(card.statusTop, "the status wraps under the title").toBeGreaterThanOrEqual(card.titleBottom - 1);
          for (const part of card.parts) {
            expect(part.clipped, `${part.selector} is not clipped`).toBe(false);
            expect(part.overflow, `${part.selector} is not truncated with an ellipsis`).not.toBe("ellipsis");
            expect(part.box.left, `${part.selector} stays inside the card`).toBeGreaterThanOrEqual(card.box.left);
            expect(part.box.right, `${part.selector} stays inside the card`).toBeLessThanOrEqual(card.box.right + 0.5);
            expect(part.box.bottom, `${part.selector} stays inside the card`).toBeLessThanOrEqual(card.box.bottom);
            if (part.selector === ".path__line") expect(part.fontSize, "the description stays legible").toBeGreaterThanOrEqual(12);
          }
        }
      });
    }

    test("takes the whole card as the target when it is a link", async ({ page }) => {
      test.skip(name === "production", "Production cards are not links.");
      await page.setViewportSize(WIDTHS.narrow);
      await page.goto(origin + "/");
      await settle(page);
      const misses = await page.evaluate(() => [...document.querySelectorAll(".paths a.path")].flatMap((card) => {
        const box = card.getBoundingClientRect();
        // Every corner and the middle of the card land on the link itself.
        return [[6, 6], [box.width - 6, 6], [6, box.height - 6], [box.width - 6, box.height - 6], [box.width / 2, box.height / 2]]
          .filter(([x, y]) => !card.contains(document.elementFromPoint(box.left + x, box.top + y)));
      }));
      expect(misses).toEqual([]);
    });
  });
}

test.describe("the Coming soon cards", () => {
  test.use({ viewport: VIEWPORTS.desktop });

  test("read as a designed state: a solid edge, a pill with a dot, and no hover", async ({ page }) => {
    await page.goto("/");
    await settle(page);
    const state = await page.evaluate(() => {
      const card = document.querySelector(".path");
      const cardStyle = getComputedStyle(card);
      const pill = getComputedStyle(card.querySelector(".path__status"));
      const dot = getComputedStyle(card.querySelector(".path__status"), "::before");
      return {
        borderStyle: cardStyle.borderTopStyle,
        pillBorder: pill.borderTopWidth,
        pillRadius: parseFloat(pill.borderTopLeftRadius),
        dotRadius: dot.borderTopLeftRadius,
        dotWidth: dot.width,
        cursor: cardStyle.cursor,
      };
    });
    expect(state.borderStyle).toBe("solid");
    expect(state.pillBorder).toBe("1px");
    expect(state.pillRadius).toBeGreaterThan(10);
    expect(state.dotWidth).toBe("6px");
    expect(state.dotRadius).toBe("50%");
    expect(state.cursor).not.toBe("pointer");
  });
});

test.describe("the linked cards", () => {
  test.use({ viewport: VIEWPORTS.desktop });

  test("take the whole card as the target, a visible focus ring, and a hover state", async ({ page }) => {
    await page.goto(dev + "/");
    await settle(page);
    const card = page.locator("a.path", { hasText: "Writing" });

    // A click near the corner, away from the title, follows the link.
    const box = await card.boundingBox();
    await page.mouse.move(box.x + box.width - 8, box.y + box.height - 8);
    const hovered = await card.evaluate((el) => getComputedStyle(el).borderTopColor);
    await page.mouse.move(2, 400);
    const resting = await card.evaluate((el) => getComputedStyle(el).borderTopColor);
    expect(hovered).not.toBe(resting);

    // The arrow steps right by at least 4px with the brighter edge, and rests at zero.
    const arrow = card.locator(".path__arrow");
    const shift = () => arrow.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41);
    await page.mouse.move(box.x + box.width - 8, box.y + box.height - 8);
    await expect.poll(shift).toBeGreaterThanOrEqual(4);
    await page.mouse.move(2, 400);
    await expect.poll(shift).toBe(0);

    await tabTo(page, "a.path[href='/writing/']");
    const ring = await page.evaluate(() => {
      const style = getComputedStyle(document.activeElement);
      return { width: style.outlineWidth, style: style.outlineStyle, isCard: document.activeElement.classList.contains("path") };
    });
    expect(ring.isCard).toBe(true);
    expect(ring.style).toBe("solid");
    expect(parseFloat(ring.width)).toBeGreaterThanOrEqual(2);

    // One clean ring, 4px clear of the edge, on a card that keeps its corners.
    const focus = await page.evaluate(() => {
      const style = getComputedStyle(document.activeElement);
      const mark = getComputedStyle(document.activeElement, "::before");
      return { offset: style.outlineOffset, shadow: style.boxShadow, radius: style.borderTopLeftRadius, mark: mark.content };
    });
    expect(focus.offset).toBe("4px");
    expect(focus.shadow).toBe("none");
    expect(focus.radius).toBe("6px");
    // The old corner mark is gone.
    expect(focus.mark).toMatch(/^(none|normal)$/);

    await page.mouse.click(box.x + box.width - 8, box.y + box.height - 8);
    await expect(page).toHaveURL(/\/writing\/$/);
  });
});

/**
 * Read the blueprint grid alone. The text and the pictures are hidden through
 * the CSSOM, so a screenshot holds only the ground and the grid. A grid line
 * is one column wide, so its strength is the brightness of a line column
 * minus a column 4px to its left. Returns the strength in the intro, the
 * header, the footer, the cards, the strips at the seams, and the strongest
 * cell, with the offset of the line columns from the content edge.
 */
async function readGrid(page) {
  const geometry = await page.evaluate(() => {
    const box = (selector) => {
      const { left, top, right, bottom, width, height } = document.querySelector(selector).getBoundingClientRect();
      return { left, top, right, bottom, width, height };
    };
    for (const selector of [".hero__main", ".lyra-globe", ".paths", ".site-header", ".site-footer"]) {
      document.querySelector(selector).style.visibility = "hidden";
    }
    const hero = box(".hero");
    return {
      intro: box(".hero__main"),
      globe: box(".lyra-globe"),
      band: box(".hero__globe"),
      cards: box(".paths"),
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
      // The stacked layout draws the grid in the globe's own band. These read
      // the middle of the band and a strip on each of its four sides.
      band: {
        middle: strength(g.band.left + g.band.width * 0.3, g.band.top + g.band.height * 0.35, g.band.right - g.band.width * 0.3, g.band.bottom - g.band.height * 0.35),
        top: strength(0, g.band.top, g.width, g.band.top + 10),
        bottom: strength(0, g.band.bottom - 10, g.width, g.band.bottom),
        left: strength(0, g.band.top + g.band.height * 0.25, 48, g.band.bottom - g.band.height * 0.25),
        right: strength(g.width - 48, g.band.top + g.band.height * 0.25, g.width, g.band.bottom - g.band.height * 0.25),
      },
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
    for (const selector of [".hero__main", ".lyra-globe", ".paths", ".site-header", ".site-footer"]) {
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

      test("does not scroll and keeps text, labels, and cards apart", async ({ page }) => {
        await page.goto("/");
        await settle(page);

        const fit = await page.evaluate(() => ({
          scrollHeight: document.documentElement.scrollHeight,
          innerHeight: window.innerHeight,
          overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          footerTop: document.querySelector(".site-footer").getBoundingClientRect().top,
          lastCardBottom: Math.max(...[...document.querySelectorAll(".path")].map((card) => card.getBoundingClientRect().bottom)),
        }));
        expect(fit.scrollHeight).toBeLessThanOrEqual(fit.innerHeight);
        expect(fit.overflowX).toBeLessThanOrEqual(1);
        // The cards leave room above the footer bar at every size.
        expect(fit.footerTop - fit.lastCardBottom).toBeGreaterThanOrEqual(24);

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
          const cards = [...document.querySelectorAll(".path")].map((el) => plain(el.getBoundingClientRect()));
          return { lines, labels, cards };
        });

        const overlap = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
        expect(boxes.labels.length).toBeGreaterThan(0);
        expect(boxes.lines.length).toBeGreaterThan(0);
        for (const label of boxes.labels) {
          for (const line of boxes.lines) {
            expect(overlap(label, line), `"${line.text}" must not cover the globe label ${label.text}`).toBe(false);
          }
        }
        expect(overlap(boxes.cards[0], boxes.cards[1]), "the two cards must not overlap").toBe(false);
        // Intro text stays above the cards.
        for (const line of boxes.lines) {
          if (line.top >= boxes.cards[0].top - 1) continue;
          for (const card of boxes.cards) expect(overlap(line, card), `"${line.text}" must not run into a card`).toBe(false);
        }
      });

      test("keeps the globe caption clear of the cards and gives the globe its room", async ({ page }) => {
        await page.goto("/");
        await settle(page);
        const read = await page.evaluate(() => {
          const caption = document.querySelector(".lyra-globe__label--caption")?.getBoundingClientRect();
          const box = document.querySelector(".lyra-globe").getBoundingClientRect();
          const canvas = document.querySelector(".lyra-globe__canvas").getBoundingClientRect();
          const cards = document.querySelector(".paths .path").getBoundingClientRect();
          const header = document.querySelector(".site-header").getBoundingClientRect();
          const eyebrow = document.querySelector(".hero__eyebrow").getBoundingClientRect();
          const more = document.querySelector(".hero__more").getBoundingClientRect();
          const main = document.querySelector(".hero__main").getBoundingClientRect();
          return {
            captionGap: caption ? cards.top - caption.bottom : Infinity,
            boxGap: cards.top - box.bottom,
            width: box.width,
            // The picture is drawn larger than the box, and the box crops it.
            zoom: canvas.width / box.width,
            eyebrowGap: eyebrow.top - header.bottom,
            moreToGlobe: box.top - more.bottom,
            centreOffset: (main.top + main.bottom) / 2 - (box.top + box.bottom) / 2,
          };
        });
        expect(read.captionGap, "the caption stays 16px above the cards").toBeGreaterThanOrEqual(16);
        expect(read.boxGap).toBeGreaterThanOrEqual(0);
        expect(read.zoom, "the box crops the empty margin of the picture, so the sphere fills the box").toBeGreaterThanOrEqual(1.25);
        // The sphere is about 85% of the box wide. The stacked layouts give the
        // globe all the room the intro and the cards leave.
        if (screen.width === 390) expect(read.width, "the globe fills the band on a phone").toBeGreaterThanOrEqual(325);
        if (screen.width === 360) expect(read.width, "the globe fills the band on a small phone").toBeGreaterThanOrEqual(280);
        if (screen.width === 820) {
          expect(read.width, "the globe grows on a tablet").toBeGreaterThanOrEqual(640);
          expect(read.moreToGlobe, "no dead band between the intro and the globe").toBeLessThanOrEqual(40);
          // The spare height is shared: the room under the header and the room
          // under the caption stay close to each other.
          expect(read.eyebrowGap, "the intro starts clear of the header").toBeGreaterThanOrEqual(32);
          expect(read.eyebrowGap).toBeLessThanOrEqual(56);
          expect(Math.abs(read.eyebrowGap - read.captionGap), "the top and the bottom of the tablet balance").toBeLessThanOrEqual(24);
        }
        if (screen.width === 1024) {
          expect(read.width, "the globe uses the room on a small laptop").toBeGreaterThanOrEqual(480);
          expect(read.captionGap, "no gap under the caption").toBeLessThanOrEqual(60);
        }
        if (screen.width > 900) {
          expect(Math.abs(read.centreOffset), "the intro and the globe share a centre line").toBeLessThanOrEqual(16);
        }
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
        expect(grid.cards, "no grid line behind the cards").toBeLessThanOrEqual(1.5);
        expect(grid.below, "no grid line in the strip above the footer").toBeLessThanOrEqual(0.6);
        expect(grid.headerSeam, "no grid line at the seam under the header").toBeLessThanOrEqual(0.6);
      });

      test("fades the phone grid to nothing on all four sides of the globe band", async ({ page }) => {
        test.skip(screen.width > 540, "Only the stacked phone layout draws the grid in the globe band.");
        await page.goto("/");
        await settle(page);
        const { band, peak } = await readGrid(page);
        // The sphere fills the band, so the grid shows around it. The strongest
        // cell of the screen sets the scale. The mask fades the grid at each
        // edge of the band, and a side strip holds one line where the mask
        // still lets a little through.
        expect(peak.contrast, "the grid shows around the sphere").toBeGreaterThanOrEqual(3);
        for (const side of ["top", "bottom", "left", "right"]) {
          expect(band[side], `the grid has faded to a fifth or less at the ${side} edge of the band`).toBeLessThanOrEqual(peak.contrast * 0.2);
        }
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
