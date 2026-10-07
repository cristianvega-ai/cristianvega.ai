import { expect, test } from "@playwright/test";
import { bandHeight, cspViolations, currentContent, currentPublished, decorativeState, DRAFT_ORIGIN as preview, drawnLabels, edgePaint, focusRingAndFade, navLink, pageProblems, recordCspViolations, settle, tabTo, textBoxes, useLabelSpy, useManualFrames, useReducedMotion, VIEWPORTS, pendingFrames, playFrames, paintedPixels } from "./fixtures.mjs";

const article = "/writing/lorem-ipsum-dolor-sit-amet/";
const qualityArticle = "/writing/nisi-ut-aliquip-ex-ea/";
const shortArticle = "/writing/exercitation-ullamco-laboris/";
const title = "Lorem ipsum dolor sit amet";
const graphic = "[data-graphic='writing']";

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test(`${name} navigation keeps the header and browser theme consistent`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await useReducedMotion(page);
    await page.goto(preview + "/");
    await settle(page);
    const header = await page.locator(".site-header__inner").boundingBox();
    await navLink(page, "writing").click();
    await expect(page.locator("#blog-title")).toBeVisible();
    expect(await page.locator(".site-header__inner").boundingBox()).toEqual(header);
    await page.getByRole("link", { name: "Nisi ut aliquip ex ea", exact: true }).click();
    await expect(page.locator("#post-title")).toBeVisible();
    await expect(page).toHaveURL(preview + qualityArticle);
    await expect(page.locator("link[rel='canonical']")).toHaveAttribute("href", "https://cristianvega.ai" + qualityArticle);
    await settle(page);
    expect(await page.locator(".site-header__inner").boundingBox()).toEqual(header);
    await expect(page.locator("meta[name='color-scheme']")).toHaveAttribute("content", "dark");
    await expect(page.locator("meta[name='theme-color']")).toHaveAttribute("content", "#14181F");
    await page.getByRole("link", { name: "Cristian Vega home" }).click();
    await expect(page.locator(".hero__name")).toBeVisible();
    await expect(page.locator("meta[name='color-scheme']")).toHaveAttribute("content", "dark");
    await expect(page.locator("meta[name='theme-color']")).toHaveAttribute("content", "#14181F");
  });

  for (const route of ["/writing/", article, qualityArticle, shortArticle]) {
    test(`${name} ${route} keeps readable content and clear navigation`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await useReducedMotion(page);
      const errors = pageProblems(page);
      await page.goto(preview + route);
      await settle(page);
      await expect(page.locator("main h1")).toHaveCount(1);
      await expect(page.locator(".nav__link[href='/writing/']")).toHaveAttribute("aria-current", route === "/writing/" ? "page" : "location");
      const layout = await page.evaluate(() => {
        const brand = document.querySelector(".brand").getBoundingClientRect();
        // Narrow screens swap the inline nav for the menu button.
        const nav = [...document.querySelectorAll(".nav, .nav-menu")].find((element) => element.getClientRects().length).getBoundingClientRect();
        const scene = document.querySelector("[data-graphic='writing']");
        const wraps = [...document.querySelectorAll("main .wrap--read")].map((element) => {
          const rect = element.getBoundingClientRect();
          return Math.round(rect.left + parseFloat(getComputedStyle(element).paddingLeft));
        });
        const header = document.querySelector(".site-header").getBoundingClientRect();
        const first = document.querySelector("main").firstElementChild.getBoundingClientRect();
        return {
          overflow: document.documentElement.scrollWidth - innerWidth,
          overlap: brand.right > nav.left,
          edges: [...new Set(wraps)],
          pointerEvents: scene && getComputedStyle(scene).pointerEvents,
          canvasWidth: scene && scene.querySelector("canvas").getBoundingClientRect().width,
          sceneWidth: scene && scene.getBoundingClientRect().width,
          sceneCount: document.querySelectorAll("[data-graphic]").length,
          headerBottom: header.bottom,
          contentTop: first.top,
          depthArt: document.querySelectorAll(".lyra-depth__fallback, .reading-hud").length,
        };
      });
      expect(layout.overflow).toBeLessThanOrEqual(1);
      expect(layout.overlap).toBe(false);
      expect(layout.edges.length).toBeLessThanOrEqual(1);
      expect(layout.depthArt).toBe(0);
      if (route === "/writing/") {
        expect(layout.pointerEvents).toBe("none");
        expect(layout.canvasWidth).toBe(layout.sceneWidth);
        // The scene has the box that every inner page has, and it stays inside the viewport. The layout spec checks its exact place.
        expect(layout.canvasWidth).toBeGreaterThan(200);
        expect(layout.canvasWidth).toBeLessThan(viewport.width);
        await expect(page.locator(graphic)).toHaveAttribute("aria-hidden", "true");
      } else {
        // Articles hold no scene, and the header never covers the first row.
        expect(layout.sceneCount).toBe(0);
        expect(layout.contentTop).toBeGreaterThanOrEqual(layout.headerBottom - 1);
      }
      await expect(page.locator("main a[href='#']")).toHaveCount(0);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await expect.poll(() => page.evaluate(() => {
        const content = document.querySelector("#main-content").getBoundingClientRect();
        const footer = document.querySelector(".site-footer").getBoundingClientRect();
        return footer.top - content.bottom;
      })).toBeGreaterThanOrEqual(0);
      expect(errors).toEqual([]);
    });
  }
}

test("drafts appear locally and stay unavailable in production", async ({ page, request }) => {
  await page.goto(preview + "/writing/");
  await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
  await settle(page);
  await expect(page.locator(".post-list__item")).toHaveCount(currentContent.writing.length);
  await expect(page.locator(".draft-label")).toHaveCount(currentContent.writing.filter((entry) => entry.data.draft).length);
  const links = await page.locator(".post-list__link").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")));
  expect(links).toEqual(currentContent.writing.map((entry) => entry.href));
  for (const entry of currentContent.writing) {
    const response = await request.get(entry.href);
    expect(response.status(), entry.href).toBe(entry.data.draft ? 404 : 200);
  }
  const index = await request.get("/writing/");
  expect(index.status()).toBe(currentPublished.writing.length > 0 ? 200 : 404);
});

test("keyboard focus lights a post and opens its article", async ({ page }) => {
  await useReducedMotion(page);
  await page.goto(preview + "/writing/");
  await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
  await settle(page);
  expect(await tabTo(page, ".post-list__link >> nth=0")).toBe(true);
  const row = page.locator(".post-list__item").first();
  await expect(page.locator(graphic)).toHaveAttribute("data-active-post", await row.getAttribute("data-post-id"));
  await expect(row).toHaveCSS("outline-style", "solid");
  await expect(row).toHaveCSS("outline-width", "3px");
  await page.keyboard.press("Enter");
  if (currentContent.writing[0].data.draft) {
    await expect(page.locator(".article__draft")).toHaveText("Draft preview · not published");
    await expect(page.locator("meta[name='robots']")).toHaveAttribute("content", "noindex, follow");
    await expect(page.locator(".author__share")).toHaveCount(0);
  } else {
    await expect(page.locator(".article__draft, meta[name='robots']")).toHaveCount(0);
    await expect(page.locator(".author__share")).toHaveCount(1);
  }
  await page.getByRole("link", { name: "← All posts" }).click();
  await expect(page.locator("#blog-title")).toBeVisible();
});

test("article sections and adjacent posts work", async ({ page }) => {
  await useReducedMotion(page);
  await page.goto(preview + article);
  await expect(page.locator(".prose h2")).toHaveCount(3);
  await expect(page.locator(".prose .pipeline")).toHaveAttribute("role", "img");
  await expect(page.locator(".prose pre")).toHaveAttribute("tabindex", "0");
  await expect(page.locator(".prose pre")).toHaveAttribute("aria-label", "Code example");
  await expect(page.locator(".reading-hud")).toHaveCount(0);
  const position = currentContent.writing.findIndex((entry) => entry.href === article);
  const newer = currentContent.writing[position - 1];
  const current = currentContent.writing[position];
  const newerLink = page.locator(".read-next__newer");
  await expect(newerLink).toHaveAttribute("href", newer.href);
  await expect(newerLink.locator("span")).toHaveText(`Newer${newer.data.draft ? " · Draft" : ""} →`);
  await newerLink.click();
  await expect(page.locator("#post-title")).toHaveText(newer.data.title);
  const olderLink = page.locator(`.read-next a[href='${article}']`);
  await expect(olderLink.locator("span")).toHaveText(`← Older${current.data.draft ? " · Draft" : ""}`);
  await olderLink.click();
  await expect(page.locator("#post-title")).toHaveText(title);
});

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test(`${name} article column starts on the frame edge`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await useReducedMotion(page);
    await page.goto(preview + article);
    await settle(page);
    const measured = await page.evaluate(() => {
      const box = (selector) => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return { left: rect.left, width: rect.width };
      };
      return {
        client: document.documentElement.clientWidth,
        copy: box(".article__head-copy"),
        utility: box(".article__utility"),
        prose: box(".prose"),
        titleSize: parseFloat(getComputedStyle(document.querySelector(".article__title")).fontSize),
        proseSize: parseFloat(getComputedStyle(document.querySelector(".prose p")).fontSize),
        proseLine: parseFloat(getComputedStyle(document.querySelector(".prose p")).lineHeight),
      };
    });
    // The column starts on the left edge of the site frame at every width.
    const width = Math.min(744, measured.client);
    const left = Math.max(0, measured.client / 2 - 480);
    for (const column of [measured.copy, measured.utility, measured.prose]) {
      expect(column.width).toBeLessThanOrEqual(744);
      expect(Math.abs(column.width - width)).toBeLessThanOrEqual(1);
      expect(Math.abs(column.left - left)).toBeLessThanOrEqual(1);
    }
    // The title takes the page title step: 28px on a phone, 36px above it.
    expect(measured.titleSize).toBe(viewport.width <= 760 ? 28 : 36);
    expect(measured.proseSize).toBe(viewport.width <= 760 ? 16 : 17);
    expect(measured.proseLine).toBeCloseTo(measured.proseSize * 1.7, 0);
  });
}

test("about and articles share one reading edge at desktop width", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await useReducedMotion(page);
  const edge = async (url, selector) => {
    await page.goto(url);
    await settle(page);
    return page.locator(selector).evaluate((element) => element.getBoundingClientRect().left);
  };
  const about = await edge("/about/", ".about__head");
  const post = await edge(preview + article, ".article__head-copy");
  expect(Math.abs(about - post)).toBeLessThanOrEqual(1);

  // The header logo, the home intro, and the columns share that same edge.
  const logo = await edge("/about/", ".brand__mark");
  const aboutTitle = await edge("/about/", "main h1");
  const postTitle = await edge(preview + article, "main h1");
  const homeTitle = await edge(preview + "/", "main h1");
  const productsTitle = await edge(preview + "/products/", "main h1");
  for (const [name, left] of Object.entries({ aboutTitle, postTitle, homeTitle, productsTitle })) {
    expect(Math.abs(left - logo), name).toBeLessThanOrEqual(1);
  }
});

test("anchors and the back link sit below the sticky header", async ({ page }) => {
  for (const viewport of Object.values(VIEWPORTS)) {
    await page.setViewportSize(viewport);
    await page.goto(preview + article);
    await settle(page);
    const headerBottom = await page.locator(".site-header").evaluate((element) => element.getBoundingClientRect().bottom);
    expect(await page.locator(".back-link").evaluate((element) => element.getBoundingClientRect().top)).toBeGreaterThanOrEqual(headerBottom);
    await page.evaluate(() => {
      const heading = document.querySelector(".prose h2");
      heading.scrollIntoView({ behavior: "instant" });
    });
    await expect.poll(() => page.locator(".prose h2").first().evaluate((element) => element.getBoundingClientRect().top - document.querySelector(".site-header").getBoundingClientRect().bottom)).toBeGreaterThanOrEqual(0);
  }
});

test("the writing index graphic sits below the sticky header", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto(preview + "/writing/");
  await settle(page);
  await page.evaluate(() => window.scrollTo({ top: 300, behavior: "instant" }));
  await expect.poll(() => page.evaluate((graphicSelector) => {
    const header = document.querySelector(".site-header").getBoundingClientRect();
    const scene = document.querySelector(graphicSelector).getBoundingClientRect();
    return Math.abs(scene.top - header.bottom);
  }, graphic)).toBeLessThanOrEqual(1);
});

test("content and links work without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: VIEWPORTS.mobile });
  const page = await context.newPage();
  await page.goto(preview + "/writing/");
  await page.getByRole("link", { name: title, exact: true }).click();
  await expect(page.locator("#post-title")).toHaveText(title);
  await expect(page.locator(".prose h2")).toHaveCount(3);
  await expect(page.locator(".prose pre")).toContainText("LoremIpsum");
  await expect(page.locator("[data-graphic]")).toHaveCount(0);
  await page.getByRole("link", { name: "← All posts" }).click();
  await expect(page.locator(".post-list__link")).toHaveCount(currentContent.writing.length);
  await expect(page.locator(graphic)).toHaveCSS("display", "none");
  await context.close();
});

test("canvas, fonts, and storage failures keep content readable", async ({ page }) => {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = () => null;
    Storage.prototype.getItem = () => { throw new Error("Storage blocked"); };
    Storage.prototype.setItem = () => { throw new Error("Storage blocked"); };
  });
  await page.route("**/*.woff2*", (route) => route.abort());
  await page.goto(preview + article);
  await expect(page.locator("#post-title")).toBeVisible();
  await expect(page.locator("#post-title")).toHaveCSS("opacity", "1");
  await expect(page.locator(".prose h2")).toHaveCount(3);
  await expect(page.locator("[data-graphic]")).toHaveCount(0);
  await page.getByRole("link", { name: "← All posts" }).click();
  await expect(page.locator(".post-list__link")).toHaveCount(currentContent.writing.length);
  // With no canvas, the graphic hides itself and the list stays.
  await expect(page.locator(graphic)).toBeHidden();
});

/** The count of painted canvas pixels under each box, given in page pixels. */
const paintUnder = (page, boxes) =>
  page.locator(`${graphic} canvas`).evaluate((canvas, list) => {
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    const context = canvas.getContext("2d");
    let count = 0;
    for (const box of list) {
      const x0 = Math.max(0, Math.floor((box.x - rect.left) * scale));
      const y0 = Math.max(0, Math.floor((box.y - rect.top) * scale));
      const x1 = Math.min(canvas.width, Math.ceil((box.x + box.w - rect.left) * scale));
      const y1 = Math.min(canvas.height, Math.ceil((box.y + box.h - rect.top) * scale));
      if (x1 <= x0 || y1 <= y0) continue;
      const { data } = context.getImageData(x0, y0, x1 - x0, y1 - y0);
      for (let i = 3; i < data.length; i += 4) if (data[i] > 8) count += 1;
    }
    return count;
  }, boxes);

test.describe("the writing graphic is decorative", () => {
  test.use({ viewport: VIEWPORTS.desktop });

  test("hides from assistive technology and takes no pointer input", async ({ page }) => {
    await page.goto(preview + "/writing/");
    await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
    const state = await decorativeState(page, graphic);
    expect(state.hidden).toBe("true");
    expect(state.pointerEvents).toEqual(["none", "none"]);
    expect(state.canvases).toBe(1);
    expect(state.focusable).toBe(0);
    expect(state.text).toBe("");
    expect(state.styled, "no style attributes in the markup").toBe(0);
  });

  test("adds no heading or link, and keeps the list readable", async ({ page }) => {
    await page.goto(preview + "/writing/");
    await expect(page.locator("main h1")).toHaveText("Writing");
    await expect(page.locator(`${graphic} :is(h1, h2, h3, a)`)).toHaveCount(0);
    await expect(page.locator(".post-list__item")).toHaveCount(currentContent.writing.length);
  });

  test("draws every label at 10px or larger", async ({ page }) => {
    await page.addInitScript(() => {
      window.__fontSizes = new Set();
      const font = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, "font");
      Object.defineProperty(CanvasRenderingContext2D.prototype, "font", {
        get: font.get,
        set(value) {
          const size = /(\d+(?:\.\d+)?)px/.exec(value);
          if (size) window.__fontSizes.add(Number(size[1]));
          font.set.call(this, value);
        },
      });
    });
    await useReducedMotion(page);
    await page.goto(preview + "/writing/");
    await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
    const sizes = await page.evaluate(() => [...window.__fontSizes]);
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) expect(size).toBeGreaterThanOrEqual(10);
  });
});

test.describe("the writing graphic never covers text", () => {
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 820, height: 1180 },
    { width: 390, height: 844 },
  ]) {
    test(`paints no pixel under any text box at ${size.width}px`, async ({ page }) => {
      await page.setViewportSize(size);
      await useReducedMotion(page);
      await page.goto(preview + "/writing/");
      await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
      await settle(page);
      for (const place of ["top", "middle"]) {
        // The site scrolls smoothly. Scroll at once, so every measurement sees the same place.
        const scroll = await page.evaluate((where) => {
          const max = Math.max(0, document.documentElement.scrollHeight - document.documentElement.clientHeight);
          const top = where === "top" ? 0 : Math.min(max, 300);
          scrollTo({ top, behavior: "instant" });
          return { top, now: scrollY };
        }, place);
        expect(Math.abs(scroll.now - scroll.top), `${place}: the page is at the ${place}`).toBeLessThanOrEqual(1);
        const shape = await page.locator(graphic).evaluate((el) => {
          const rect = el.getBoundingClientRect();
          return { w: rect.width, h: rect.height };
        });
        expect(shape.w, `${place}: the graphic has a width`).toBeGreaterThan(300);
        expect(shape.h, `${place}: the graphic has a height`).toBeGreaterThan(150);
        const texts = await textBoxes(page);
        expect(texts.length).toBeGreaterThan(0);
        expect(await paintedPixels(page, graphic, 8), `${place}: the picture is drawn`).toBeGreaterThan(3000);
        expect(await paintUnder(page, texts), `${place}: the picture must not paint under text`).toBe(0);
      }
    });
  }

  for (const size of [{ width: 1099, height: 900 }, { width: 1024, height: 768 }, { width: 820, height: 1180 }, VIEWPORTS.mobile]) {
    test(`sits above the list and takes a block 19% taller than the shared band at ${size.width}px`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto(preview + "/writing/");
      await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
      const block = await page.evaluate((selector) => {
        const root = document.querySelector(selector);
        const rect = root.getBoundingClientRect();
        return {
          position: getComputedStyle(root).position,
          height: rect.height,
          bottom: rect.bottom + scrollY,
          list: document.querySelector(".blog-index__list").getBoundingClientRect().top + scrollY,
        };
      }, graphic);
      expect(block.position).not.toBe("sticky");
      expect(Math.abs(block.height - bandHeight(size.height) * 1.19), "the block is the shared band plus 19%").toBeLessThanOrEqual(1);
      expect(block.bottom).toBeLessThanOrEqual(block.list);
    });
  }

  test("sits beside the list from 1100px, as the fixed box of the other pages", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.goto(preview + "/writing/");
    await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
    const place = await page.evaluate((selector) => {
      const root = document.querySelector(selector);
      return { position: getComputedStyle(root).position, left: root.getBoundingClientRect().left, listRight: document.querySelector(".blog-index__list").getBoundingClientRect().right };
    }, graphic);
    expect(place.position).toBe("fixed");
    expect(place.left, "right of the list").toBeGreaterThanOrEqual(place.listRight);
  });
});

test.describe("the writing graphic labels and family look", () => {
  for (const size of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 820, height: 1180 }, VIEWPORTS.mobile]) {
    test(`keeps every label 24px from the canvas edge and 32px from the viewport edge at ${size.width}px`, async ({ page }) => {
      await page.setViewportSize(size);
      await useLabelSpy(page);
      await useReducedMotion(page);
      await page.goto(preview + "/writing/");
      await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
      const { labels, viewport } = await drawnLabels(page);
      // Every post number is drawn. A star name is drawn only where the layout finds a clear place for it,
      // and a small band can have none, so the star names are not counted.
      const posts = await page.locator(".post-list__item").count();
      expect(posts).toBeGreaterThan(0);
      expect(labels.filter((label) => label.text.startsWith("N°")).length, "every post number is drawn").toBe(posts);
      for (const label of labels) {
        expect(label.localLeft, `"${label.text}" left`).toBeGreaterThanOrEqual(24);
        expect(label.localRight, `"${label.text}" right`).toBeLessThanOrEqual(label.canvasWidth - 24);
        expect(label.localTop, `"${label.text}" top`).toBeGreaterThanOrEqual(24);
        expect(label.localBottom, `"${label.text}" bottom`).toBeLessThanOrEqual(label.canvasHeight - 24);
        expect(label.right, `"${label.text}" viewport right`).toBeLessThanOrEqual(viewport - 32);
      }
    });
  }

  test("draws its labels over an ink halo and fades its canvas edges", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await useLabelSpy(page);
    await useReducedMotion(page);
    await page.goto(preview + "/writing/");
    await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
    const { labels, ink } = await drawnLabels(page);
    for (const label of labels) {
      expect(label.halo?.style, `"${label.text}" halo colour`).toBe(ink);
      expect(label.halo?.lineJoin).toBe("round");
    }
    const mask = await page.locator(`${graphic} canvas`).evaluate((canvas) => getComputedStyle(canvas).maskImage || getComputedStyle(canvas).webkitMaskImage);
    expect(mask).toContain("linear-gradient");
  });

  test("draws no corner bracket and no plus lattice, only the faint site grid", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await useReducedMotion(page);
    await page.goto(preview + "/writing/");
    await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
    // The old frame put brackets 6px in from every corner. The grid fades to nothing at the corners.
    const painted = await page.locator(`${graphic} canvas`).evaluate((canvas) => {
      const context = canvas.getContext("2d");
      const { width, height } = canvas;
      const count = (x, y) => {
        const { data } = context.getImageData(x, y, 20, 20);
        let total = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i] > 8) total += 1;
        return total;
      };
      return [count(width - 22, 2), count(width - 22, height - 22)];
    });
    expect(painted).toEqual([0, 0]);
  });
});

test.describe("the writing graphic uses page bindings", () => {
  for (const size of Object.values(VIEWPORTS)) {
    test(`reads labels after presentation classes change at ${size.width}px`, async ({ page }) => {
      await page.setViewportSize(size);
      await useReducedMotion(page);
      await useLabelSpy(page);
      await page.route(`${preview}/writing/`, async (route) => {
        const response = await route.fetch();
        const body = (await response.text())
          .replace('class="blog-index__list"', 'class="binding-list"')
          .replaceAll('class="post-list__num"', 'class="binding-label"')
          .replace(/(class="binding-label"[^>]*>)[^<]*/, "$1Entry A");
        await route.fulfill({ response, body });
      });
      await page.goto(`${preview}/writing/`);
      await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
      await settle(page);
      const labels = (await drawnLabels(page)).labels.map((label) => label.text);
      expect(labels).toContain("Entry A");
      const expected = (await page.locator("[data-writing-label]").allTextContents()).map((label) => label.trim());
      expect(labels).toEqual(expect.arrayContaining(expected));
    });

    test(`reads entry IDs through writing hooks at ${size.width}px`, async ({ page }) => {
      await page.setViewportSize(size);
      await useReducedMotion(page);
      await page.route(`${preview}/writing/`, async (route) => {
        const response = await route.fetch();
        const body = (await response.text()).replaceAll("data-post-id=", "data-old-entry=");
        await route.fulfill({ response, body });
      });
      await page.goto(`${preview}/writing/`);
      await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
      const row = page.locator("[data-writing-entry-id]").first();
      await row.dispatchEvent("pointerenter");
      await expect(page.locator(graphic)).toHaveAttribute("data-active-post", await row.getAttribute("data-writing-entry-id"));
      await row.dispatchEvent("pointerleave");
      await expect(page.locator(graphic)).not.toHaveAttribute("data-active-post", /.*/);
      await row.locator("a").focus();
      await expect(page.locator(graphic)).toHaveAttribute("data-active-post", await row.getAttribute("data-writing-entry-id"));
    });

    test(`ignores entries and labels outside its page at ${size.width}px`, async ({ page }) => {
      await page.setViewportSize(size);
      await useReducedMotion(page);
      await useLabelSpy(page);
      await page.route(`${preview}/writing/`, async (route) => {
        const response = await route.fetch();
        const outside = '<aside data-writing-page hidden><section class="blog-index__list" data-writing-list><ol><li data-post-id="outside" data-writing-entry-id="outside"><span class="post-list__num" data-writing-label>Outside entry</span></li></ol></section></aside>';
        const body = (await response.text()).replace('<main class="blog-index"', `${outside}<main class="blog-index"`);
        await route.fulfill({ response, body });
      });
      await page.goto(`${preview}/writing/`);
      await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
      await settle(page);
      const labels = (await drawnLabels(page)).labels.map((label) => label.text);
      expect(labels).not.toContain("Outside entry");
      const outside = page.locator("[data-writing-entry-id='outside']");
      await outside.dispatchEvent("pointerenter");
      await expect(page.locator(graphic)).not.toHaveAttribute("data-active-post", /.*/);
      await outside.dispatchEvent("focusin");
      await expect(page.locator(graphic)).not.toHaveAttribute("data-active-post", /.*/);
    });
  }
});

test.describe("the writing graphic entrance", () => {
  test.use({ viewport: VIEWPORTS.desktop });

  test("keeps the canvas as wide as its box after a resize", async ({ page }) => {
    await useReducedMotion(page);
    await page.goto(preview + "/writing/");
    await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
    await page.setViewportSize(VIEWPORTS.mobile);
    await expect.poll(() => page.locator(`${graphic} canvas`).evaluate((canvas) =>
      Math.abs(canvas.width / devicePixelRatio - canvas.getBoundingClientRect().width),
    )).toBeLessThanOrEqual(1);
  });
});

test.describe("the writing graphic pauses and tears down", () => {

  test("cancels its frames and its listeners on pagehide, and sets up again on a restored page", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await useManualFrames(page);
    await page.goto(preview + "/writing/");
    await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
    await playFrames(page, 3000);
    await page.locator(".post-list__item").nth(1).hover();
    await expect(page.locator(graphic)).toHaveAttribute("data-active-post", /.+/);
    expect(await pendingFrames(page)).toBe(1);

    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
    expect(await pendingFrames(page), "no frame stays queued after pagehide").toBe(0);
    await expect(page.locator(graphic)).not.toHaveAttribute("data-ready", /.*/);
    await expect(page.locator(graphic)).not.toHaveAttribute("data-motion-state", /.*/);
    await expect(page.locator(graphic)).not.toHaveAttribute("data-active-post", /.*/);
    // The listeners are gone: a post that takes the pointer lights nothing.
    await page.locator(".post-list__item").nth(2).hover();
    await expect(page.locator(graphic)).not.toHaveAttribute("data-active-post", /.*/);
    expect(await pendingFrames(page)).toBe(0);

    // The entrance is over, so a restored page rests with no queued frame. Its listeners return.
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
    expect(await pendingFrames(page), "a restored page at rest queues no frame").toBe(0);
    await page.mouse.move(2, 2);
    await page.locator(".post-list__item").nth(1).hover();
    await expect(page.locator(graphic)).toHaveAttribute("data-active-post", /.+/);
    expect(await pendingFrames(page), "a lit post asks for frames after a restored page").toBe(1);
  });
});

test.describe("the writing graphic answers a lit post", () => {
  test.use({ viewport: VIEWPORTS.desktop });

  /** Count the changes to data-active-post from now on. */
  const watchActive = (page) =>
    page.evaluate(() => {
      window.__writes = 0;
      window.__observer?.disconnect();
      window.__observer = new MutationObserver((records) => {
        window.__writes += records.length;
      });
      window.__observer.observe(document.querySelector("[data-graphic='writing']"), { attributes: true, attributeFilter: ["data-active-post"] });
    });
  const writes = (page) => page.evaluate(() => (window.__observer.takeRecords(), window.__writes));

  test("the pointer sets the active post once for each change and runs frames only while it is lit", async ({ page }) => {
    await useManualFrames(page);
    await page.goto(preview + "/writing/");
    await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
    await playFrames(page, 3000);
    await expect(page.locator(graphic)).toHaveAttribute("data-motion-state", "still");
    expect(await pendingFrames(page), "the picture rests with no lit post").toBe(0);
    await watchActive(page);

    const second = page.locator(".post-list__item").nth(1);
    await second.hover();
    await expect(page.locator(graphic)).toHaveAttribute("data-active-post", await second.getAttribute("data-post-id"));
    expect(await pendingFrames(page), "a lit post asks for frames").toBe(1);
    const before = await paintedPixels(page, graphic, 200);
    for (let i = 0; i < 20; i += 1) await playFrames(page, 16);
    expect(await writes(page), "twenty frames write no attribute").toBe(1);
    await playFrames(page, 400);
    expect(await paintedPixels(page, graphic, 200), "the path to Vega adds paint").toBeGreaterThan(before);

    await page.mouse.move(2, 2);
    await expect(page.locator(graphic)).not.toHaveAttribute("data-active-post", /.*/);
    await playFrames(page, 2000);
    expect(await writes(page)).toBe(2);
    expect(await pendingFrames(page), "the loop stops once the glow has faded").toBe(0);
  });

  test("keyboard focus sets the active post, and leaving clears it", async ({ page }) => {
    await useReducedMotion(page);
    await page.goto(preview + "/writing/");
    await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
    await watchActive(page);
    expect(await tabTo(page, ".post-list__link >> nth=1")).toBe(true);
    const second = page.locator(".post-list__item").nth(1);
    await expect(page.locator(graphic)).toHaveAttribute("data-active-post", await second.getAttribute("data-post-id"));
    await page.keyboard.press("Tab");
    await expect(page.locator(graphic)).toHaveAttribute("data-active-post", await page.locator(".post-list__item").nth(2).getAttribute("data-post-id"));
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator(graphic)).toHaveAttribute("data-active-post", await page.locator(".post-list__item").first().getAttribute("data-post-id"));
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator(graphic)).not.toHaveAttribute("data-active-post", /.*/);
  });

  test("reduced motion draws a lit post at once and runs no frame", async ({ page }) => {
    await useManualFrames(page);
    await useReducedMotion(page);
    await page.goto(preview + "/writing/");
    await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
    const canvas = page.locator(`${graphic} canvas`);
    const rest = await canvas.evaluate((element) => element.toDataURL());
    await page.locator(".post-list__item").nth(1).hover();
    await expect(page.locator(graphic)).toHaveAttribute("data-active-post", /.+/);
    expect(await canvas.evaluate((element) => element.toDataURL()), "the picture changes on the same turn").not.toBe(rest);
    expect(await pendingFrames(page)).toBe(0);
    await page.mouse.move(2, 2);
    expect(await canvas.evaluate((element) => element.toDataURL())).toBe(rest);
  });
});

test.describe("the writing graphic in preview", () => {
  test("runs with no console error and no CSP violation", async ({ page }) => {
    const problems = pageProblems(page, ["error", "warning"]);
    await recordCspViolations(page);
    for (const size of [VIEWPORTS.desktop, VIEWPORTS.mobile]) {
      await page.setViewportSize(size);
      await page.goto(preview + "/writing/");
      await expect(page.locator(graphic)).toHaveAttribute("data-motion-state", "still", { timeout: 10_000 });
      await page.locator(".post-list__item").nth(1).hover();
      await expect(page.locator(graphic)).toHaveAttribute("data-active-post", /.+/);
      expect(await cspViolations(page)).toEqual([]);
    }
    expect(problems).toEqual([]);
  });
});

test("production writing follows publication and keeps the security policy", async ({ page }) => {
  const response = await page.goto("/writing/");
  const visible = currentPublished.writing.length > 0;
  expect(response.status()).toBe(visible ? 200 : 404);
  expect(response.headers()["content-security-policy"]).toContain("style-src-attr 'none'");
  await expect(page.locator("[data-graphic='writing']")).toHaveCount(visible ? 1 : 0);
  await expect(page.locator("[data-graphic='404']")).toHaveCount(visible ? 0 : 1);
  await expect(page.locator(".post-list")).toHaveCount(visible ? 1 : 0);
  await expect(page.locator(".post-list__item")).toHaveCount(currentPublished.writing.length);
  if (visible) await expect(page.locator("meta[name='robots'], .draft-label")).toHaveCount(0);
});

test("wide code and diagrams scroll inside the column and show a focus ring", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto(preview + article);
  await settle(page);

  for (const selector of [".prose pre", ".figure__panel"]) {
    const box = page.locator(selector).first();
    const state = await box.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return {
        overflowX: getComputedStyle(el).overflowX,
        scrolls: el.scrollWidth > el.clientWidth,
        right: rect.right,
        client: document.documentElement.clientWidth,
        tabIndex: el.tabIndex,
      };
    });
    expect(state.overflowX, selector).toBe("auto");
    expect(state.scrolls, selector).toBe(true);
    expect(state.right, selector).toBeLessThanOrEqual(state.client);
    expect(state.tabIndex, selector).toBe(0);

    // A keyboard user reaches it, sees a ring, and can scroll it.
    await box.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(box).toBeFocused();
    const ring = await box.evaluate((el) => {
      const style = getComputedStyle(el);
      return { style: style.outlineStyle, width: parseFloat(style.outlineWidth), offset: parseFloat(style.outlineOffset) };
    });
    expect(ring.style, selector).not.toBe("none");
    expect(ring.width, selector).toBeGreaterThanOrEqual(2);
    // Inside the box, so the code block's clipped corners cannot hide it.
    expect(ring.offset, selector).toBeLessThan(0);
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => box.evaluate((el) => el.scrollLeft), { message: selector }).toBeGreaterThan(0);
  }
});

for (const width of [820, 390, 360]) {
  test(`the article eyebrow never ends a line with a dot at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(preview + article);
    await settle(page);
    const state = await page.locator("main .eyebrow").evaluate((eyebrow) => {
      const parts = [...eyebrow.querySelectorAll(".eyebrow__part")].map((part) => part.getBoundingClientRect());
      return { parts: parts.length, box: eyebrow.getBoundingClientRect().toJSON(), first: parts[0], second: parts[1] };
    });
    expect(state.parts).toBe(2);
    const wrapped = state.second.top >= state.first.bottom - 1;
    // On one line the second clause follows the first, after room for the dot.
    // On two lines the second clause starts left of the box, so its dot is clipped.
    if (wrapped) expect(state.second.left).toBeLessThanOrEqual(state.box.left);
    else expect(state.second.left).toBeGreaterThanOrEqual(state.first.right - 1);
  });
}

test.describe("the last focusable element clears the footer fade", () => {
  for (const [name, viewport] of [["desktop", VIEWPORTS.desktop], ["mobile", VIEWPORTS.mobile]]) {
    for (const route of ["/writing/", "/products/", article]) {
      test(`the focus ring of the last control on ${route} sits above the fade on ${name}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await useReducedMotion(page);
        await page.goto(preview + route);
        await settle(page);
        const focusable = "main :is(a[href], button:not([hidden]), [tabindex='0'])";
        expect(await tabTo(page, `${focusable} >> nth=-1`, 80), "the last control takes keyboard focus").toBe(true);
        await expect.poll(async () => {
          const { ringBottom, fadeTop } = await focusRingAndFade(page);
          return fadeTop - ringBottom;
        }, "the whole ring is above the fade").toBeGreaterThanOrEqual(0);
        const { ringTop } = await focusRingAndFade(page);
        expect(ringTop, "the ring stays below the header").toBeGreaterThanOrEqual(
          await page.evaluate(() => document.querySelector(".site-header").getBoundingClientRect().bottom - 1),
        );
      });
    }
  }
});

test.describe("the writing graphic keeps its figure inside the box", () => {
  for (const [name, viewport] of [["desktop", VIEWPORTS.desktop], ["mobile", VIEWPORTS.mobile]]) {
    test(`keeps every strong mark 28px inside the canvas edge on ${name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await useReducedMotion(page);
      await page.goto(preview + "/writing/");
      await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
      const painted = await edgePaint(page, graphic);
      for (const side of ["left", "right", "top", "bottom"]) expect(painted[side], `strong paint at the ${side} edge`).toBe(0);
    });
  }

  test("the phone band is at most 20% taller than the about band", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    const height = async (path, selector) => {
      await page.goto(preview + path);
      await expect(page.locator(selector)).toHaveAttribute("data-ready", "true");
      return page.locator(selector).evaluate((el) => el.getBoundingClientRect().height);
    };
    const about = await height("/about/", "[data-graphic='about']");
    const writing = await height("/writing/", graphic);
    expect(writing).toBeGreaterThanOrEqual(about);
    expect(writing).toBeLessThanOrEqual(about * 1.2 + 1);
  });

  test("the title has no decode layer and reads as plain text on the first frame", async ({ page }) => {
    await useManualFrames(page);
    await page.goto(preview + "/writing/");
    await expect(page.locator("#blog-title")).toHaveText("Writing");
    await expect(page.locator("#blog-title *")).toHaveCount(0);
    await expect(page.locator("#blog-title")).not.toHaveAttribute("data-decode", /.*/);
  });
});
