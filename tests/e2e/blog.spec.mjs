import { expect, test } from "@playwright/test";
import { navLink, settle, tabTo, useReducedMotion, VIEWPORTS } from "./fixtures.mjs";

const preview = "http://127.0.0.1:4324";
const article = "/writing/lorem-ipsum-dolor-sit-amet/";
const qualityArticle = "/writing/nisi-ut-aliquip-ex-ea/";
const shortArticle = "/writing/exercitation-ullamco-laboris/";
const title = "Lorem ipsum dolor sit amet";

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
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
      await page.goto(preview + route);
      await settle(page);
      await expect(page.locator("main h1")).toHaveCount(1);
      await expect(page.locator(".nav__link[href='/writing/']")).toHaveAttribute("aria-current", route === "/writing/" ? "page" : "location");
      const layout = await page.evaluate(() => {
        const brand = document.querySelector(".brand").getBoundingClientRect();
        // Narrow screens swap the inline nav for the menu button.
        const nav = [...document.querySelectorAll(".nav, .nav-menu")].find((element) => element.getClientRects().length).getBoundingClientRect();
        const scene = document.querySelector("[data-lyra]");
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
          canvasWidth: scene && scene.querySelector(".lyra-scene__canvas").getBoundingClientRect().width,
          sceneWidth: scene && scene.getBoundingClientRect().width,
          sceneCount: document.querySelectorAll("[data-lyra]").length,
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
        // The scene stays inside the 960px site frame, so its labels never pass the frame's right edge.
        expect(layout.canvasWidth).toBe(Math.min(viewport.width, 960));
        await expect(page.locator("[data-lyra]")).toHaveAttribute("aria-hidden", "true");
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
  await expect(page.locator(".post-list__item")).toHaveCount(8);
  await expect(page.locator(".draft-label")).toHaveCount(8);
  const links = await page.locator(".post-list__link").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")));
  for (const link of links) {
    expect(link).toMatch(/^\/writing\/[^/]+\/$/);
    const response = await request.get(link);
    expect(response.status()).toBe(404);
  }
  // Production has no published post, so it builds no writing index.
  const index = await request.get("/writing/");
  expect(index.status()).toBe(404);
});

test("keyboard focus lights a post and opens its article", async ({ page }) => {
  await useReducedMotion(page);
  await page.goto(preview + "/writing/");
  expect(await tabTo(page, ".post-list__link >> nth=0")).toBe(true);
  const row = page.locator(".post-list__item").first();
  await expect(page.locator("[data-lyra]")).toHaveAttribute("data-active-post", await row.getAttribute("data-post-id"));
  await expect(row).toHaveCSS("outline-style", "solid");
  await expect(row).toHaveCSS("outline-width", "3px");
  await page.keyboard.press("Enter");
  await expect(page.locator(".article__draft")).toHaveText("Draft preview · not published");
  await expect(page.locator("meta[name='robots']")).toHaveAttribute("content", "noindex, follow");
  await expect(page.locator(".author__share")).toHaveCount(0);
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
  await page.getByRole("link", { name: /Newer · Draft/ }).click();
  await expect(page.locator("#post-title")).toHaveText("Consectetur adipiscing elit");
  await page.getByRole("link", { name: /Older · Draft/ }).click();
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
    if (viewport.width <= 760) expect(measured.titleSize).toBe(39);
    else expect(measured.titleSize).toBeGreaterThan(39);
    expect(measured.proseSize).toBe(viewport.width <= 760 ? 17 : 18);
    expect(measured.proseLine).toBeCloseTo(measured.proseSize * 1.8, 0);
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

test("the writing index scene sits below the sticky header", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto(preview + "/writing/");
  await settle(page);
  await page.evaluate(() => window.scrollTo({ top: 300, behavior: "instant" }));
  await expect.poll(() => page.evaluate(() => {
    const header = document.querySelector(".site-header").getBoundingClientRect();
    const scene = document.querySelector(".lyra-scene--index").getBoundingClientRect();
    return Math.abs(scene.top - header.bottom);
  })).toBeLessThanOrEqual(1);
});

test("content and links work without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: VIEWPORTS.mobile });
  const page = await context.newPage();
  await page.goto(preview + "/writing/");
  await page.getByRole("link", { name: title, exact: true }).click();
  await expect(page.locator("#post-title")).toHaveText(title);
  await expect(page.locator(".prose h2")).toHaveCount(3);
  await expect(page.locator(".prose pre")).toContainText("LoremIpsum");
  await expect(page.locator(".decode-noise")).toHaveCount(0);
  await expect(page.locator("[data-lyra]")).toHaveCount(0);
  await page.getByRole("link", { name: "← All posts" }).click();
  await expect(page.locator(".post-list__link")).toHaveCount(8);
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
  await expect(page.locator(".decode-noise")).toHaveCount(0);
  await expect(page.locator("[data-lyra]")).toHaveCount(0);
  await page.getByRole("link", { name: "← All posts" }).click();
  await expect(page.locator(".post-list__link")).toHaveCount(8);
});

test("the index motion finishes and responds to a reduced-motion change", async ({ page }) => {
  await useReducedMotion(page, "no-preference");
  await page.goto(preview + "/writing/");
  await expect(page.locator("[data-lyra]")).toHaveAttribute("data-motion-state", "playing");
  await expect(page.locator("[data-lyra]")).toHaveAttribute("data-motion-state", "still");
  await expect(page.locator(".decode-noise")).toHaveCount(0);
  await useReducedMotion(page);
  await expect(page.locator("[data-lyra]")).toHaveAttribute("data-motion-state", "still");
  await page.setViewportSize(VIEWPORTS.mobile);
  await expect.poll(() => page.locator(".lyra-scene__canvas").evaluate((canvas) =>
    Math.abs(canvas.width / devicePixelRatio - canvas.getBoundingClientRect().width),
  )).toBeLessThanOrEqual(1);
});

test("reduced motion keeps the index canvas still after layout", async ({ page }) => {
  await useReducedMotion(page);
  await page.addInitScript(() => {
    window.blogPaints = 0;
    const drawImage = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      if (this.canvas.classList.contains("lyra-scene__canvas")) window.blogPaints += 1;
      return drawImage.apply(this, args);
    };
  });
  await page.goto(preview + "/writing/");
  await expect(page.locator("[data-lyra]")).toHaveAttribute("data-motion-state", "still");
  await page.evaluate(() => document.fonts.ready);
  const changes = await page.locator(".lyra-scene__canvas").evaluate(async (canvas) => {
    await new Promise(requestAnimationFrame);
    const first = canvas.toDataURL();
    const paints = window.blogPaints;
    for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
    return first !== canvas.toDataURL() || paints !== window.blogPaints;
  });
  expect(changes).toBe(false);
});

test("production has no writing index and keeps the security policy on its 404", async ({ page }) => {
  const response = await page.goto("/writing/");
  expect(response.status()).toBe(404);
  expect(response.headers()["content-security-policy"]).toContain("style-src-attr 'none'");
  await expect(page.locator("[data-lyra]")).toHaveCount(0);
  await expect(page.locator(".post-list")).toHaveCount(0);
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
