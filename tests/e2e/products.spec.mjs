import { expect, test } from "@playwright/test";

import { currentContent, DRAFT_ORIGIN as dev, pageProblems, pendingFrames, playFrames, useManualFrames, drawnLabels, edgePaint, GRAPHIC_VIEWPORTS as SIZES, openGraphic as open, settle, textBoxes, useLabelSpy, useReducedMotion, VIEWPORTS } from "./fixtures.mjs";

// Check product flows and product graphic expectations.

const PAGES = {
  products: { name: "products index", url: `${dev}/products/`, graphic: "[data-graphic='products']", restMs: 31_000 },
  product: { name: "product page", url: `${dev}/products/lorem-ipsum-dolor/`, graphic: "[data-graphic='products']", restMs: 31_000 },
};

const WIDTHS = { ...VIEWPORTS, wide: { width: 1920, height: 1080 }, narrow: { width: 360, height: 740 } };

/** Read the product marks from the latest canvas frame. Keep the canvas drawing active. */
async function useProductMarks(page) {
  await page.addInitScript(() => {
    const proto = CanvasRenderingContext2D.prototype;
    let path = null;
    for (const method of ["clearRect", "beginPath", "arc", "ellipse", "moveTo", "lineTo", "fill", "stroke", "drawImage"]) {
      const original = proto[method];
      proto[method] = function (...args) {
        if (this.canvas.parentElement?.dataset.graphic === "products") {
          if (method === "clearRect") window.__productMarks = { cores: [], rings: [], links: [], marks: [], orbits: [] };
          if (method === "beginPath") path = null;
          if (method === "arc") path = { kind: "arc", x: args[0], y: args[1], radius: args[2] };
          if (method === "ellipse") path = { kind: "ellipse", x: args[0], y: args[1], rx: args[2], ry: args[3] };
          if (method === "moveTo") path = { kind: "line", ax: args[0], ay: args[1] };
          if (method === "lineTo" && path?.kind === "line") Object.assign(path, { bx: args[0], by: args[1] });
          if (method === "fill" && path?.kind === "arc") {
            window.__productMarks.cores.push({ ...path, alpha: this.globalAlpha });
            window.__productMarks.marks.push({ x: path.x, y: path.y, reach: path.radius });
          }
          if (method === "stroke" && path?.kind === "arc") {
            if (path.radius === 7.5) window.__productMarks.rings.push({ ...path, alpha: this.globalAlpha });
            window.__productMarks.marks.push({ x: path.x, y: path.y, reach: path.radius + this.lineWidth / 2, radius: path.radius });
          }
          if (method === "stroke" && path?.kind === "ellipse") {
            window.__productMarks.orbits.push({ x: path.x, y: path.y, rx: path.rx + this.lineWidth / 2, ry: path.ry + this.lineWidth / 2 });
          }
          if (method === "drawImage" && args.length === 5) {
            window.__productMarks.marks.push({ x: args[1] + args[3] / 2, y: args[2] + args[4] / 2, reach: args[3] / 2 });
          }
          if (method === "stroke" && path?.kind === "line" && Math.abs(this.lineWidth - 0.8) < 1e-6) {
            window.__productMarks.links.push({ ...path, alpha: this.globalAlpha });
          }
        }
        return original.apply(this, args);
      };
    }
  });
}

/** Give the test page a product count and a current product before its graphic mounts. Keep the content files unchanged. */
async function openOrbit(page, { count, current, reduced = false }) {
  const errors = pageProblems(page);
  await useManualFrames(page);
  await useProductMarks(page);
  if (reduced) await useReducedMotion(page);
  await page.addInitScript((inputs) => {
    const observer = new MutationObserver(() => {
      const root = document.querySelector("[data-graphic='products']");
      if (!root) return;
      root.dataset.products = String(inputs.count);
      root.dataset.current = String(inputs.current);
      observer.disconnect();
    });
    observer.observe(document, { childList: true, subtree: true });
  }, { count, current });
  await open(page, PAGES.product);
  await settle(page);
  await expect(page.locator(PAGES.product.graphic)).toHaveAttribute("data-products", String(count));
  return errors;
}

/** Give the test page eight products before its graphic mounts. */
const openFullOrbit = (page, reduced = false) => openOrbit(page, { count: 8, current: 0, reduced });

/** Check each product core, ring, and link in the latest frame. */
async function expectFullOrbit(page) {
  const { marks, width, height } = await page.locator(`${PAGES.product.graphic} canvas`).evaluate((canvas) => {
    const box = canvas.getBoundingClientRect();
    return { marks: window.__productMarks, width: box.width, height: box.height };
  });
  expect(marks.rings, "all eight products have a ring").toHaveLength(8);
  expect(marks.links, "all eight products have a link").toHaveLength(8);
  for (const [index, ring] of marks.rings.entries()) {
    const core = marks.cores.find((mark) => mark.x === ring.x && mark.y === ring.y);
    const link = marks.links.find((mark) => mark.ax === ring.x && mark.ay === ring.y);
    expect(core, `product ${index} has a core`).toBeDefined();
    expect(link, `product ${index} has a link`).toBeDefined();
    expect(core.radius, `product ${index} has its full size`).toBeCloseTo(2.6, 12);
    expect(core.alpha, `product ${index} has its full light`).toBe(1);
    expect(ring.alpha, `product ${index} has its full ring`).toBeCloseTo(0.5, 12);
    expect(link.bx, `product ${index} reaches Vega on x`).toBeCloseTo(width / 2, 8);
    expect(link.by, `product ${index} reaches Vega on y`).toBeCloseTo(height / 2, 8);
    expect(link.alpha, `product ${index} has its full link`).toBeCloseTo(0.32, 6);
    expect(ring.x).toBeGreaterThanOrEqual(32 - 1e-8);
    expect(ring.x).toBeLessThanOrEqual(width - 32 + 1e-8);
    expect(ring.y).toBeGreaterThanOrEqual(32 - 1e-8);
    expect(ring.y).toBeLessThanOrEqual(height - 32 + 1e-8);
  }
}

test.describe("products on the dev server", () => {
  test.use({ viewport: VIEWPORTS.desktop });

  test("the index and the detail page read like the article pages", async ({ page }) => {
    await page.goto(dev + "/products/");
    await expect(page.locator("main h1")).toHaveText("Products");
    await expect(page.locator(".nav__link[href='/products/']")).toHaveAttribute("aria-current", "page");
    if (currentContent.products.some((entry) => entry.data.draft)) {
      await expect(page.locator("meta[name='robots']")).toHaveAttribute("content", "noindex, follow");
    } else await expect(page.locator("meta[name='robots']")).toHaveCount(0);
    await expect(page.locator("meta[name='color-scheme']")).toHaveAttribute("content", "dark");
    await page.getByRole("link", { name: "Lorem ipsum dolor" }).click();

    await expect(page).toHaveURL(dev + "/products/lorem-ipsum-dolor/");
    await expect(page.locator("main h1")).toHaveText("Lorem ipsum dolor");
    await expect(page.locator(".nav__link[href='/products/']")).toHaveAttribute("aria-current", "location");
    const product = currentContent.products.find((entry) => entry.id === "lorem-ipsum-dolor");
    if (product.data.draft) {
      await expect(page.locator("meta[name='robots']")).toHaveAttribute("content", "noindex, follow");
    } else await expect(page.locator("meta[name='robots']")).toHaveCount(0);
    await expect(page.locator(".product__prose")).toContainText("Lorem ipsum dolor sit amet, consectetur adipiscing elit");
    await expect(page.getByRole("link", { name: "All products →" })).toHaveAttribute("href", "/products/");
    const outbound = page.locator(".product__link[target='_blank']");
    if (product.data.url) {
      await expect(outbound).toHaveAttribute("href", product.data.url);
      await expect(outbound).toHaveAttribute("rel", "noopener noreferrer");
    } else await expect(outbound).toHaveCount(0);
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

for (const target of Object.values(PAGES)) {
  test.describe(`the ${target.name} graphic is decorative`, () => {
    test.use({ viewport: VIEWPORTS.desktop });

    test("hides from assistive technology and takes no pointer input", async ({ page }) => {
      await open(page, target);
      const state = await page.evaluate((selector) => {
        const root = document.querySelector(selector);
        return {
          hidden: root.getAttribute("aria-hidden"),
          pointerEvents: [root, root.querySelector("canvas")].map((part) => getComputedStyle(part).pointerEvents),
          canvases: root.querySelectorAll("canvas").length,
          focusable: root.querySelectorAll("a, button, input, select, textarea, [tabindex]").length,
          text: root.textContent.trim(),
          styled: root.querySelectorAll("[style]").length + (root.hasAttribute("style") ? 1 : 0),
          headings: root.querySelectorAll("h1, h2, h3, a").length,
        };
      }, target.graphic);
      expect(state.hidden).toBe("true");
      expect(state.pointerEvents).toEqual(["none", "none"]);
      expect(state.canvases).toBe(1);
      expect(state.focusable).toBe(0);
      expect(state.text).toBe("");
      expect(state.styled, "no style attributes in the markup").toBe(0);
      expect(state.headings, "no heading or link inside the graphic").toBe(0);
    });
  });

  test.describe(`the ${target.name} graphic never overlaps text`, () => {
    for (const size of SIZES) {
      test(`keeps clear of every text box at ${size.width}px`, async ({ page }) => {
        await page.setViewportSize(size);
        await open(page, target);
        await settle(page);
        // The fixed box stays in view. The band scrolls, so it is checked at the top and at the bottom of the page.
        for (const place of ["top", "bottom"]) {
          // The site scrolls smoothly. Scroll at once, so both measurements see the same place.
          const scroll = await page.evaluate((where) => {
            const top = where === "top" ? 0 : Math.max(0, document.documentElement.scrollHeight - document.documentElement.clientHeight);
            scrollTo({ top, behavior: "instant" });
            return { top, now: scrollY };
          }, place);
          expect(Math.abs(scroll.now - scroll.top), `${place}: the page is at the ${place}`).toBeLessThanOrEqual(1);
          const shape = await page.locator(target.graphic).evaluate((el) => {
            const rect = el.getBoundingClientRect();
            return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
          });
          expect(shape.w, `${place}: the box has a width`).toBeGreaterThan(100);
          expect(shape.h, `${place}: the box has a height`).toBeGreaterThan(100);
          const texts = await textBoxes(page);
          expect(texts.length).toBeGreaterThan(0);
          for (const text of texts) {
            const apart =
              text.x + text.w <= shape.x || shape.x + shape.w <= text.x || text.y + text.h <= shape.y || shape.y + shape.h <= text.y;
            expect(apart, `${place}: the graphic overlaps a text box at ${JSON.stringify(text)}`).toBe(true);
          }
        }
      });
    }
  });

  test.describe(`the ${target.name} graphic bounds`, () => {
    for (const size of SIZES) {
      test(`keeps every strong mark 28px inside the canvas edge at ${size.width}px`, async ({ page }) => {
        await page.setViewportSize(size);
        await useReducedMotion(page);
        await open(page, target);
        const painted = await edgePaint(page, target.graphic);
        // A band is short, so only the sides count there. The mesh, the star field, and the grid may enter the edge fade.
        const sides = size.width >= 1100 ? ["left", "right", "top", "bottom"] : ["left", "right"];
        for (const side of sides) expect(painted[side], `strong paint at the ${side} edge`).toBe(0);
      });
    }
  });

  test.describe(`the ${target.name} graphic labels`, () => {
    for (const size of SIZES) {
      test(`keep 32px from the viewport edge, clear of the fade, and inside the canvas at ${size.width}px`, async ({ page }) => {
        await page.setViewportSize(size);
        await useLabelSpy(page);
        await useReducedMotion(page);
        await open(page, target);
        const { labels, viewport } = await drawnLabels(page);
        expect(labels.length, "the graphic names Vega").toBeGreaterThan(0);
        expect(labels.map((label) => label.text)).toContain("VEGA · α LYR");
        for (const label of labels) {
          expect(label.left, `"${label.text}" left of the viewport edge`).toBeGreaterThanOrEqual(32);
          expect(label.right, `"${label.text}" right of the viewport edge`).toBeLessThanOrEqual(viewport - 32);
          expect(label.localTop, `"${label.text}" top of the canvas`).toBeGreaterThanOrEqual(16);
          expect(label.localBottom, `"${label.text}" bottom of the canvas`).toBeLessThanOrEqual(label.canvasHeight - 16);
        }
      });
    }

    test("carry an ink halo in the page ground colour", async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.desktop);
      await useLabelSpy(page);
      await useReducedMotion(page);
      await open(page, target);
      const { labels, ink } = await drawnLabels(page);
      expect(labels.length).toBeGreaterThan(0);
      for (const label of labels) {
        expect(label.halo, `"${label.text}" has a halo`).not.toBeNull();
        expect(label.halo.style, `"${label.text}" halo colour`).toBe(ink);
        expect(label.halo.lineJoin).toBe("round");
        expect(label.halo.lineWidth).toBeGreaterThanOrEqual(3);
        expect(label.halo.lineWidth).toBeLessThanOrEqual(4);
      }
    });

    test("fades the canvas edges with a mask", async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.desktop);
      await open(page, target);
      const mask = await page.locator(`${target.graphic} canvas`).evaluate((canvas) => {
        const style = getComputedStyle(canvas);
        return { image: style.maskImage || style.webkitMaskImage, composite: style.maskComposite || style.webkitMaskComposite };
      });
      expect(mask.image).toContain("linear-gradient");
      expect(mask.composite).toMatch(/intersect|source-in/);
    });
  });
}

test.describe("the products graphic shows the products", () => {
  test.use({ viewport: VIEWPORTS.desktop });

  test("exposes the lit-product count, and it matches the list", async ({ page }) => {
    await open(page, PAGES.products);
    const listed = await page.locator(".entries--products .entries__item").count();
    expect(listed).toBeGreaterThan(0);
    await expect(page.locator(PAGES.products.graphic)).toHaveAttribute("data-products", String(listed));
  });

  test("a product page shows the same count and marks its own star", async ({ page }) => {
    await open(page, PAGES.products);
    const listed = await page.locator(".entries--products .entries__item").count();
    await open(page, PAGES.product);
    const root = page.locator(PAGES.product.graphic);
    await expect(root).toHaveAttribute("data-products", String(listed));
    // The dev server lists drafts too, in the same order as the content inventory.
    const current = currentContent.products.findIndex((entry) => entry.id === "lorem-ipsum-dolor");
    expect(current).toBeGreaterThanOrEqual(0);
    await expect(root).toHaveAttribute("data-current", String(current));
  });

  for (const target of [PAGES.products, PAGES.product]) {
    test(`the ${target.name} uses its count when list classes change or unrelated products appear`, async ({ page }) => {
      await open(page, PAGES.products);
      const listed = await page.locator("[data-product-id]").count();
      expect(listed).toBeGreaterThan(0);
      await useProductMarks(page);
      await useReducedMotion(page);
      await page.route(target.url, async (route) => {
        const response = await route.fetch();
        const body = (await response.text())
          .replace('class="entries entries--products"', 'class="entries binding-products"')
          .replaceAll('class="entries__item"', 'class="binding-product"')
          .replace("</main>", '</main><ol class="entries--products" hidden><li class="entries__item"></li><li class="entries__item"></li></ol>');
        await route.fulfill({ response, body });
      });
      await open(page, target);
      await settle(page);
      await expect(page.locator(target.graphic)).toHaveAttribute("data-products", String(listed));
      const marks = await page.evaluate(() => window.__productMarks);
      expect(marks.rings).toHaveLength(listed);
      expect(marks.links).toHaveLength(listed);
    });
  }
});

test.describe("the products graphic fills every active slot", () => {
  for (const size of Object.values(VIEWPORTS)) {
    test(`finishes eight products after the entrance and keeps the drift at ${size.width}px`, async ({ page }) => {
      await page.setViewportSize(size);
      const errors = await openFullOrbit(page);
      await expect.poll(() => pendingFrames(page)).toBe(1);
      await playFrames(page, 2400);
      await expectFullOrbit(page);
      await expect(page.locator(PAGES.product.graphic)).toHaveAttribute("data-motion-state", "playing");
      expect(await pendingFrames(page)).toBe(1);
      await playFrames(page, PAGES.product.restMs);
      await expectFullOrbit(page);
      await expect(page.locator(PAGES.product.graphic)).toHaveAttribute("data-motion-state", "still");
      expect(await pendingFrames(page)).toBe(0);
      expect(errors).toEqual([]);
    });

    test(`finishes eight products on the first frame with reduced motion at ${size.width}px`, async ({ page }) => {
      await page.setViewportSize(size);
      const errors = await openFullOrbit(page, true);
      await expectFullOrbit(page);
      await expect(page.locator(PAGES.product.graphic)).toHaveAttribute("data-motion-state", "still");
      expect(await pendingFrames(page)).toBe(0);
      expect(errors).toEqual([]);
    });
  }
});

test.describe("the products graphic keeps every mark inside the figure inset", () => {
  // Slot 1 sits on the outer orbit at the right edge of a column and at the top of a band.
  // Slot 3 sits on the outer orbit at the left edge of a column and at the bottom of a band.
  for (const { count, current } of [{ count: 1, current: 0 }, { count: 2, current: 1 }, { count: 8, current: 3 }]) {
    for (const size of SIZES) {
      test(`keeps ${count} product marks and the current ring inside the inset at ${size.width}px`, async ({ page }) => {
        await page.setViewportSize(size);
        const errors = await openOrbit(page, { count, current, reduced: true });
        const { marks, width, height } = await page.locator(`${PAGES.product.graphic} canvas`).evaluate((canvas) => {
          const box = canvas.getBoundingClientRect();
          return { marks: window.__productMarks, width: box.width, height: box.height };
        });
        const inset = 32;
        // A lit slot draws a 7.5px ring, in product order. An empty slot draws a 4.5px ring.
        const lit = marks.rings;
        const empty = marks.marks.filter((mark) => mark.radius === 4.5);
        expect(lit, "every product has a ring").toHaveLength(count);
        expect(lit.length + empty.length, "the picture shows six slots or more").toBe(Math.max(6, count));
        const ringed = marks.marks.filter((mark) => mark.radius === 11.5);
        expect(ringed, "the current product has its own ring").toHaveLength(1);
        expect(ringed[0].x).toBe(lit[current].x);
        expect(ringed[0].y).toBe(lit[current].y);
        for (const [index, slot] of [...lit, ...empty].entries()) {
          const around = marks.marks.filter((mark) => Math.abs(mark.x - slot.x) < 1e-6 && Math.abs(mark.y - slot.y) < 1e-6);
          if (index < count) expect(around.length, `product ${index} has a ring, a core, and a halo`).toBeGreaterThanOrEqual(3);
          const reach = Math.max(...around.map((mark) => mark.reach));
          const where = `slot ${index} at (${slot.x.toFixed(1)}, ${slot.y.toFixed(1)}) with a reach of ${reach}`;
          expect(slot.x - reach, `${where}: left`).toBeGreaterThanOrEqual(inset - 1e-6);
          expect(slot.x + reach, `${where}: right`).toBeLessThanOrEqual(width - inset + 1e-6);
          expect(slot.y - reach, `${where}: top`).toBeGreaterThanOrEqual(inset - 1e-6);
          expect(slot.y + reach, `${where}: bottom`).toBeLessThanOrEqual(height - inset + 1e-6);
        }
        expect(marks.orbits, "the three orbits").toHaveLength(3);
        for (const orbit of marks.orbits) {
          expect(orbit.x - orbit.rx, "orbit left").toBeGreaterThanOrEqual(inset - 1e-6);
          expect(orbit.x + orbit.rx, "orbit right").toBeLessThanOrEqual(width - inset + 1e-6);
          expect(orbit.y - orbit.ry, "orbit top").toBeGreaterThanOrEqual(inset - 1e-6);
          expect(orbit.y + orbit.ry, "orbit bottom").toBeLessThanOrEqual(height - inset + 1e-6);
        }
        expect(errors).toEqual([]);
      });
    }
  }
});
