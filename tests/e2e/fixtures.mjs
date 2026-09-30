/**
 * Shared helpers for the browser suite.
 *
 * Specs assert computed layout and runtime behavior — things absent from the
 * built HTML and therefore unreachable from the Node contract tests. Anything
 * here is page-agnostic; page-specific selectors belong in the spec that uses
 * them.
 */

/** Widths and heights that each select a distinct branch of the design system. */
export const VIEWPORTS = {
  /** Comfortably above every breakpoint. */
  desktop: { width: 1440, height: 900 },
  /** Below the 960px layout breakpoint. */
  tablet: { width: 900, height: 1000 },
  /** Below the 760px and 520px refinements. */
  mobile: { width: 390, height: 844 },
};

/**
 * The height of the graphic band below 1100px on a screen of a given height. The band
 * follows the screen height between 144px and 240px, the same clamp as global.css.
 */
export const bandHeight = (screenHeight) => Math.min(240, Math.max(144, screenHeight * 0.2));

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
  await page.evaluate(() => Promise.all([...document.fonts].map((face) => face.load().catch(() => undefined))).then(() => document.fonts.ready));
  await page
    .locator("main")
    .evaluate((el) =>
      Promise.all(el.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined))),
    );
}

/**
 * Set the reduced-motion preference for this page.
 *
 * Always use this. `test.use({ reducedMotion: "reduce" })` is a silent no-op in
 * this project — under Playwright 1.62.1 the option never reaches the context,
 * `matchMedia("(prefers-reduced-motion: reduce)").matches` stays false, and the
 * test runs with motion fully enabled while appearing to assert the opposite.
 * It fails open, so nothing warns you. `page.emulateMedia` works correctly.
 */
export async function useReducedMotion(page, reducedMotion = "reduce") {
  await page.emulateMedia({ reducedMotion });
}

/** Tab forward until the target holds focus, so :focus-visible genuinely applies. */
export async function tabTo(page, selector, limit = 25) {
  const target = page.locator(selector);

  for (let i = 0; i < limit; i += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((el) => el === document.activeElement)) return true;
  }

  return false;
}

/**
 * Locate a header link by its label. At 640px and below the links sit in a
 * menu, so this opens the menu first when its button is showing.
 * Returns the link locator. Call it again after each navigation.
 */
export function navLink(page, name) {
  const link = page.locator(".nav:visible, .nav-menu:visible").getByRole("link", { name, exact: true });
  return {
    async click() {
      const toggle = page.locator(".nav-menu__toggle:visible");
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

/** Box of every text run in main, taken before the content is hidden. */
export async function textBoxes(page) {
  return page.evaluate(() => {
    const boxes = [];
    const walker = document.createTreeWalker(document.querySelector("main"), NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (rect.width > 0 && rect.bottom > 0 && rect.top < innerHeight) {
          boxes.push({ x: rect.left, y: rect.top, w: rect.width, h: rect.height });
        }
      }
    }
    return boxes;
  });
}

/**
 * Record every label a page graphic draws, with the halo drawn under it. Call it before the page loads.
 * Read the result with `drawnLabels`. It keeps the latest draw of each text on each canvas.
 */
export async function useLabelSpy(page) {
  await page.addInitScript(() => {
    const colour = document.createElement("canvas").getContext("2d");
    const normalise = (value) => {
      colour.fillStyle = "#000";
      colour.fillStyle = value;
      return colour.fillStyle;
    };
    const proto = CanvasRenderingContext2D.prototype;
    const fillText = proto.fillText;
    const strokeText = proto.strokeText;
    window.__labels = new Map();
    let halo = null;
    proto.strokeText = function (text, x, y, ...rest) {
      halo = { text, x, y, lineWidth: this.lineWidth, lineJoin: this.lineJoin, style: normalise(this.strokeStyle) };
      return strokeText.call(this, text, x, y, ...rest);
    };
    proto.fillText = function (text, x, y, ...rest) {
      const transform = this.getTransform();
      const key = `${text}@${this.canvas.width}`;
      window.__labels.set(key, {
        text,
        x: x + transform.e / transform.a,
        y: y + transform.f / transform.d,
        align: this.textAlign,
        width: this.measureText(text).width,
        canvas: this.canvas,
        halo: halo && halo.text === text && halo.x === x && halo.y === y ? halo : null,
      });
      return fillText.call(this, text, x, y, ...rest);
    };
  });
}

/** The labels drawn so far, as boxes in page pixels, and the ink and ground colours of the page. */
export async function drawnLabels(page) {
  return page.evaluate(() => {
    const colour = document.createElement("canvas").getContext("2d");
    colour.fillStyle = "#000";
    colour.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim();
    const ink = colour.fillStyle;
    const labels = [...window.__labels.values()].map((label) => {
      const box = label.canvas.getBoundingClientRect();
      const left = label.align === "left" ? label.x : label.align === "right" ? label.x - label.width : label.x - label.width / 2;
      return {
        text: label.text,
        left: box.left + left,
        right: box.left + left + label.width,
        top: box.top + label.y - 6,
        bottom: box.top + label.y + 6,
        // The same box in canvas pixels.
        localLeft: left,
        localRight: left + label.width,
        localTop: label.y - 6,
        localBottom: label.y + 6,
        canvasWidth: box.width,
        canvasHeight: box.height,
        halo: label.halo && { lineWidth: label.halo.lineWidth, lineJoin: label.halo.lineJoin, style: label.halo.style },
      };
    });
    return { labels, ink, viewport: document.documentElement.clientWidth };
  });
}

/**
 * Count the strongly painted canvas pixels within `inset` CSS pixels of each canvas edge.
 * The figure must keep out of this zone. The faint mesh, star field, and grid may enter it,
 * so only a pixel with an alpha above `minAlpha` (0 to 255) counts.
 */
export async function edgePaint(page, graphic, inset = 28, minAlpha = 140) {
  return page.locator(`${graphic} canvas`).evaluate(
    (canvas, [zone, threshold]) => {
      const scale = canvas.width / canvas.getBoundingClientRect().width;
      const band = Math.round(zone * scale);
      const { width, height } = canvas;
      const context = canvas.getContext("2d");
      const count = (x, y, w, h) => {
        const { data } = context.getImageData(x, y, w, h);
        let total = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i] > threshold) total += 1;
        return total;
      };
      return {
        left: count(0, 0, band, height),
        right: count(width - band, 0, band, height),
        top: count(0, 0, width, band),
        bottom: count(0, height - band, width, band),
      };
    },
    [inset, minAlpha],
  );
}

/**
 * The bottom of the focus ring of the focused element, and the top of the footer fade, in page pixels.
 * The ring belongs to the focused element or to the nearest ancestor that draws an outline, as on a post row.
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
