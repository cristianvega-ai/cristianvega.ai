import { expect, test } from "@playwright/test";

import { bandHeight, drawnLabels, edgePaint, settle, textBoxes, useLabelSpy, useManualFrames, useReducedMotion, VIEWPORTS, pendingFrames, playFrames, paintedPixels } from "./fixtures.mjs";

/**
 * Check the About graphic beside the reading column and in the narrow band.
 * Keep reader interaction and marker expectations in this suite.
 * Keep shared lifecycle checks in page-graphics.spec.mjs.
 */

const graphic = "[data-graphic='about']";

test.describe("the about graphic is decorative", () => {
  test.use({ viewport: VIEWPORTS.desktop });

  test("hides from assistive technology and takes no pointer input", async ({ page }) => {
    await page.goto("/about/");
    await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
    const state = await page.evaluate((selector) => {
      const root = document.querySelector(selector);
      return {
        hidden: root.getAttribute("aria-hidden"),
        pointerEvents: [root, root.querySelector("canvas")].map((part) => getComputedStyle(part).pointerEvents),
        canvases: root.querySelectorAll("canvas").length,
        focusable: root.querySelectorAll("a, button, input, select, textarea, [tabindex]").length,
        text: root.textContent.trim(),
        styled: root.querySelectorAll("[style]").length + (root.hasAttribute("style") ? 1 : 0),
      };
    }, graphic);
    expect(state.hidden).toBe("true");
    expect(state.pointerEvents).toEqual(["none", "none"]);
    expect(state.canvases).toBe(1);
    expect(state.focusable).toBe(0);
    expect(state.text).toBe("");
    expect(state.styled, "no style attributes in the markup").toBe(0);
  });

  test("leaves the real content readable and adds no heading or link", async ({ page }) => {
    await page.goto("/about/");
    await expect(page.locator("h1")).toHaveText("Cristian Vega");
    await expect(page.locator(`${graphic} :is(h1, h2, h3, a)`)).toHaveCount(0);
  });
});

test.describe("the about graphic never overlaps text", () => {
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 820, height: 1180 },
    { width: 390, height: 844 },
  ]) {
    test(`keeps clear of every text box at ${size.width}px`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto("/about/");
      await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
      await settle(page);

      const box = () =>
        page.locator(graphic).evaluate((el) => {
          const rect = el.getBoundingClientRect();
          return { x: rect.left, y: rect.top, w: rect.width, h: rect.height, position: getComputedStyle(el).position };
        });
      // The fixed box stays in view. The band scrolls, so it is checked at the top and at the bottom of the page.
      for (const place of ["top", "middle", "bottom"]) {
        // The site scrolls smoothly. Scroll at once, so both measurements see the same place.
        const scroll = await page.evaluate((where) => {
          const max = document.documentElement.scrollHeight - innerHeight;
          const top = where === "top" ? 0 : where === "middle" ? max / 2 : max;
          scrollTo({ top, behavior: "instant" });
          return { top, now: scrollY };
        }, place);
        expect(Math.abs(scroll.now - scroll.top), `${place}: the page is at the ${place}`).toBeLessThanOrEqual(1);
        const shape = await box();
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

  test("sits in the grid box beside the column, above the grid layer, from 1100px", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.goto("/about/");
    await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
    const placed = await page.evaluate((selector) => {
      const root = document.querySelector(selector);
      const rect = root.getBoundingClientRect();
      const style = getComputedStyle(root);
      const footer = document.querySelector(".site-footer").getBoundingClientRect();
      const fade = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--footer-fade"));
      return {
        position: style.position,
        zIndex: style.zIndex,
        gridZIndex: getComputedStyle(document.body, "::before").zIndex,
        left: rect.left,
        columnRight: document.querySelector("main .wrap--read").getBoundingClientRect().right,
        gap: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--graphic-gap")),
        top: rect.top,
        header: document.querySelector(".site-header").getBoundingClientRect().bottom,
        right: rect.right,
        bottom: rect.bottom,
        barTop: footer.height + fade,
      };
    }, graphic);
    expect(placed.position).toBe("fixed");
    expect(Number(placed.zIndex), "above the grid layer").toBeGreaterThan(Number(placed.gridZIndex));
    expect(Math.abs(placed.left - placed.columnRight - placed.gap), "the box starts one shared gap right of the column").toBeLessThanOrEqual(1);
    expect(Math.abs(placed.top - placed.header)).toBeLessThanOrEqual(1);
    expect(placed.right).toBe(VIEWPORTS.desktop.width);
    expect(Math.abs(VIEWPORTS.desktop.height - placed.barTop - placed.bottom)).toBeLessThanOrEqual(1);
  });

  test("sits in a band between the header and the title below 1100px", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto("/about/");
    await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
    const band = await page.evaluate((selector) => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return {
        position: getComputedStyle(document.querySelector(selector)).position,
        top: rect.top,
        bottom: rect.bottom,
        height: rect.height,
        header: document.querySelector(".site-header").getBoundingClientRect().bottom,
        title: document.querySelector("#about-title").getBoundingClientRect().top,
      };
    }, graphic);
    expect(band.position).not.toBe("fixed");
    expect(band.top).toBeGreaterThanOrEqual(band.header);
    expect(band.bottom).toBeLessThanOrEqual(band.title);
    expect(Math.abs(band.height - bandHeight(VIEWPORTS.mobile.height)), "the band has the shared height").toBeLessThanOrEqual(1);
  });
});

test.describe("the about graphic without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  for (const size of [VIEWPORTS.desktop, VIEWPORTS.mobile]) {
    test(`takes no space and shows only the page at ${size.width}px`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto("/about/");
      await expect(page.locator(graphic)).toHaveCSS("display", "none");
      await expect(page.locator("h1")).toBeVisible();
      await expect(page.locator(".about__lede")).toBeVisible();
    });
  }
});

test.describe("the about graphic entrance", () => {
  test.use({ viewport: VIEWPORTS.desktop });

  test("reduced motion paints the settled picture on the first frame and runs no frames", async ({ page }) => {
    await useManualFrames(page);
    await useReducedMotion(page);
    await page.goto("/about/");
    await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
    await expect(page.locator(graphic)).toHaveAttribute("data-motion-state", "still");
    expect(await pendingFrames(page)).toBe(0);
    expect(await paintedPixels(page, graphic, 8), "the path, the mesh, and the marker are drawn at once").toBeGreaterThan(3000);
    // At the top of the page the marker rests at the start of the path.
    await expect(page.locator(graphic)).toHaveAttribute("data-progress", "0");
  });
});

test.describe("the about graphic follows the reader", () => {
  test.use({ viewport: { width: 1440, height: 600 } });

  test("maps the reader's place to the whole path: the start at the top, Vega at the bottom", async ({ page }) => {
    await page.goto("/about/");
    await expect(page.locator(graphic)).toHaveAttribute("data-motion-state", "still", { timeout: 10_000 });
    const progress = async () => Number(await page.locator(graphic).getAttribute("data-progress"));
    const at = (where) => page.evaluate((share) => scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * share), where);

    await expect.poll(progress, "rests at the start of the path at the top").toBeCloseTo(0, 2);
    await at(0.5);
    await expect.poll(progress).toBeGreaterThan(0.45);
    await expect.poll(progress).toBeLessThan(0.55);
    await at(1);
    await expect.poll(progress, "reaches Vega at the bottom").toBeCloseTo(1, 2);
    // The loop stops once the marker reaches the reader.
    await expect(page.locator(graphic)).toHaveAttribute("data-motion-state", "still");
    await at(0);
    await expect.poll(progress).toBeCloseTo(0, 2);
  });

  test("rests on the full path when the page cannot scroll", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 5000 });
    await page.goto("/about/");
    await expect(page.locator(graphic)).toHaveAttribute("data-motion-state", "still", { timeout: 10_000 });
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), "the page fits the window").toBe(true);
    await expect(page.locator(graphic)).toHaveAttribute("data-progress", "1");
  });

  test("ends the entrance with no jump in brightness", async ({ page }) => {
    await useManualFrames(page);
    await page.goto("/about/");
    await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
    // The paint weight of the canvas: the sum of its alpha. A lit path adds weight, and a pop adds a step.
    const weight = () =>
      page.locator(`${graphic} canvas`).evaluate((canvas) => {
        const { data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
        let sum = 0;
        for (let i = 3; i < data.length; i += 4) sum += data[i];
        return sum;
      });
    // Step one frame at a time through the end of the entrance.
    await playFrames(page, 1600);
    let previous = await weight();
    const steps = [];
    for (let time = 1600; time < 2400; time += 16) {
      await playFrames(page, 16);
      const now = await weight();
      steps.push(Math.abs(now - previous) / previous);
      previous = now;
    }
    expect(Math.max(...steps), "no single frame changes the paint weight by more than 4%").toBeLessThan(0.04);
  });

  test("the entrance lights the path up to the marker: the lit length never falls and never passes it", async ({ page }) => {
    await useManualFrames(page);
    await page.goto("/about/");
    await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
    await page.evaluate(() => scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * 0.5));
    const lit = [];
    for (let time = 0; time < 3200; time += 16) {
      await playFrames(page, 16);
      lit.push(Number(await page.locator(graphic).getAttribute("data-progress")));
    }
    for (let i = 1; i < lit.length; i += 1) {
      expect(lit[i], `frame ${i}: the lit length must not fall`).toBeGreaterThanOrEqual(lit[i - 1]);
    }
    const settled = lit[lit.length - 1];
    expect(settled, "the entrance ends at the marker").toBeGreaterThan(0.45);
    expect(settled).toBeLessThan(0.55);
    expect(Math.max(...lit), "the light never overshoots the marker").toBeLessThanOrEqual(settled + 0.005);
    expect(lit[Math.floor(lit.length / 4)], "the light is still drawing in a quarter of the way through").toBeLessThan(settled - 0.05);
  });

  test("at the top of the page the entrance lights nothing and the marker waits at the start", async ({ page }) => {
    await useManualFrames(page);
    await page.goto("/about/");
    await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
    await playFrames(page, 3200);
    await expect(page.locator(graphic)).toHaveAttribute("data-progress", "0");
  });

  test("on a page that cannot scroll, the entrance lights the whole path to Vega", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 5000 });
    await useManualFrames(page);
    await page.goto("/about/");
    await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
    await playFrames(page, 3200);
    await expect(page.locator(graphic)).toHaveAttribute("data-progress", "1");
  });

  test("reduced motion lights the path to the reader's place and the marker jumps without easing", async ({ page }) => {
    await useManualFrames(page);
    await useReducedMotion(page);
    await page.goto("/about/");
    await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
    // No frame runs, so a value that follows the scroll at once cannot come from an eased marker.
    await page.evaluate(() => scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * 0.5));
    await expect.poll(async () => Number(await page.locator(graphic).getAttribute("data-progress"))).toBeGreaterThan(0.45);
    expect(Number(await page.locator(graphic).getAttribute("data-progress"))).toBeLessThan(0.55);
    expect(await pendingFrames(page)).toBe(0);
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await expect(page.locator(graphic)).toHaveAttribute("data-progress", "1");
    expect(await pendingFrames(page)).toBe(0);
  });

  test("reduced motion on a page that cannot scroll lights the whole path", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 5000 });
    await useManualFrames(page);
    await useReducedMotion(page);
    await page.goto("/about/");
    await expect(page.locator(graphic)).toHaveAttribute("data-progress", "1");
  });

  test("writes the marker place at most once for each frame", async ({ page }) => {
    await useManualFrames(page);
    await page.goto("/about/");
    await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
    await page.evaluate(() => {
      window.__observer = new MutationObserver(() => {});
      window.__observer.observe(document.querySelector("[data-graphic]"), { attributes: true, attributeFilter: ["data-progress"] });
    });
    // Run the entrance to its end. Then scroll to the bottom and step frame by frame.
    await playFrames(page, 3000);
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    const writes = [];
    for (let i = 0; i < 20; i += 1) {
      writes.push(
        await page.evaluate(() => {
          window.__observer.takeRecords();
          window.__time += 16;
          window.__step(window.__time);
          return window.__observer.takeRecords().length;
        }),
      );
    }
    expect(Math.max(...writes)).toBeLessThanOrEqual(1);
    expect(writes.reduce((sum, count) => sum + count, 0), "the marker moved").toBeGreaterThan(3);
  });
});

test.describe("the about graphic in production", () => {
  test("runs with no console error and no CSP violation", async ({ page }) => {
    const problems = [];
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") problems.push(message.text());
    });
    page.on("pageerror", (error) => problems.push(error.message));
    await page.addInitScript(() => {
      window.__csp = [];
      document.addEventListener("securitypolicyviolation", (event) => window.__csp.push(event.violatedDirective));
    });
    for (const size of [VIEWPORTS.desktop, VIEWPORTS.mobile]) {
      await page.setViewportSize(size);
      await page.goto("/about/");
      await expect(page.locator(graphic)).toHaveAttribute("data-motion-state", "still", { timeout: 10_000 });
      await page.evaluate(() => scrollTo(0, 1e6));
      await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
      expect(await page.evaluate(() => window.__csp)).toEqual([]);
    }
    expect(problems).toEqual([]);
  });
});

test.describe("the about graphic labels and edges", () => {
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 820, height: 1180 },
    { width: 390, height: 844 },
  ]) {
    test(`keeps the Vega label 32px from the viewport edge at ${size.width}px`, async ({ page }) => {
      await page.setViewportSize(size);
      await useLabelSpy(page);
      await useReducedMotion(page);
      await page.goto("/about/");
      await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
      const { labels, viewport } = await drawnLabels(page);
      const vega = labels.find((label) => label.text === "VEGA · α LYR");
      expect(vega, "the graphic names Vega").toBeTruthy();
      expect(vega.left).toBeGreaterThanOrEqual(32);
      expect(vega.right).toBeLessThanOrEqual(viewport - 32);
      expect(vega.localTop).toBeGreaterThanOrEqual(16);
    });
  }

  test("draws the label over an ink halo in the ground colour", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await useLabelSpy(page);
    await useReducedMotion(page);
    await page.goto("/about/");
    await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
    const { labels, ink } = await drawnLabels(page);
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(label.halo?.style).toBe(ink);
      expect(label.halo?.lineJoin).toBe("round");
      expect(label.halo?.lineWidth).toBeGreaterThanOrEqual(3);
      expect(label.halo?.lineWidth).toBeLessThanOrEqual(4);
    }
  });

  test("fades the canvas edges with a mask, so nothing clips at the viewport edge or the header line", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.goto("/about/");
    await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
    const mask = await page.locator(`${graphic} canvas`).evaluate((canvas) => {
      const style = getComputedStyle(canvas);
      return { image: style.maskImage || style.webkitMaskImage, composite: style.maskComposite || style.webkitMaskComposite };
    });
    expect(mask.image).toContain("linear-gradient");
    expect(mask.composite).toMatch(/intersect|source-in/);
  });
});

test.describe("the about graphic keeps its figure inside the box", () => {
  for (const size of [
    { width: 1920, height: 1080 },
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ]) {
    test(`keeps every strong mark 28px inside the canvas edge at ${size.width}px`, async ({ page }) => {
      await page.setViewportSize(size);
      await useReducedMotion(page);
      await page.goto("/about/");
      await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
      const painted = await edgePaint(page, graphic);
      // A band is short, so only the sides count there. The mesh and the grid may enter the edge fade.
      const sides = size.width >= 1100 ? ["left", "right", "top", "bottom"] : ["left", "right"];
      for (const side of sides) expect(painted[side], `strong paint at the ${side} edge`).toBe(0);
    });
  }
});
