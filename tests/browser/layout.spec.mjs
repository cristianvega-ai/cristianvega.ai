import { chromium, expect, test } from "@playwright/test";
import sharp from "sharp";

import { headerLinks } from "../helpers.mjs";
import { bandHeight, openGraphic as open, currentContent, currentPublished, DRAFT_ORIGIN as dev, settle, tabTo, textBoxes, VIEWPORTS } from "./fixtures.mjs";

/**
 * Shell contracts that every route owes the reader, checked on all of them at
 * once rather than page by page.
 *
 * This exists because two retired pages both shipped a wide page head over a
 * narrow body. Each container was centred, so each looked right on its own,
 * but their left edges sat 170px apart and the page read as tilting right as
 * the eye moved from the headline into the text. A per-page spec did not catch
 * it: the defect is a relationship between containers, and it repeats wherever
 * the pattern is copied.
 */

const ROUTES = [
  "/",
  /* Any unknown path: the static host serves 404.html for it. */
  "/no-such-page/",
];

/** Content-edge insets of every centred page container, ignoring the box's own bleed. */
async function containers(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("main .wrap:not(.wrap--read)")].map((el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        left: Math.round(rect.left + parseFloat(style.paddingLeft)),
        right: Math.round(
          document.documentElement.clientWidth - (rect.right - parseFloat(style.paddingRight)),
        ),
      };
    }),
  );
}

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test.describe(`${name} shell`, () => {
    test.use({ viewport });

    for (const route of ROUTES) {
      test(`${route} keeps one left edge and no overflow`, async ({ page }) => {
        await page.goto(route);
        await settle(page);

        const boxes = await containers(page);

        // The 404 page uses the reading column, which sits on the frame's
        // left edge instead of the centre. The frame test below covers it.
        if (route === "/") {
          expect(boxes.length).toBeGreaterThan(0);

          // Every container starts in the same place. Centring each one
          // separately is not enough — two different caps share a centre while
          // starting 170px apart, which is exactly the drift that shipped.
          const lefts = new Set(boxes.map((b) => b.left));
          expect([...lefts]).toHaveLength(1);

          // And each is centred, so the page is not simply inset from one side.
          for (const box of boxes) {
            expect(Math.abs(box.left - box.right)).toBeLessThanOrEqual(1);
          }
        }

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(1);
      });
    }
  });
}

test.describe("document structure", () => {
  test.use({ viewport: VIEWPORTS.desktop });

  for (const route of ROUTES) {
    test(`${route} carries exactly one h1`, async ({ page }) => {
      await page.goto(route);
      await expect(page.locator("h1")).toHaveCount(1);
    });
  }
});

test.describe("the footer holds the foot of the viewport", () => {
  /* Deliberately taller than the shortest pages, so the slack is real. */
  test.use({ viewport: { width: 1440, height: 1200 } });

  for (const route of ROUTES) {
    test(`${route} keeps its footer on screen, clear of the content`, async ({ page }) => {
      await page.goto(route);
      await settle(page);

      // Seated at the foot on arrival. A short page used to end wherever its
      // content did, leaving paper under the ink footer: 82px on a retired
      // page, 402px on the 404.
      const onArrival = await page.evaluate(() => {
        const footer = document.querySelector(".site-footer");
        return footer ? window.innerHeight - footer.getBoundingClientRect().bottom : null;
      });
      expect(onArrival).not.toBeNull();
      expect(onArrival).toBeLessThanOrEqual(1);

      // Still there at the bottom of the scroll. Position fixed makes the
      // check above pass for free, so on its own it proves nothing.
      await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" }));

      const afterScroll = await page.evaluate(() => {
        const footer = document.querySelector(".site-footer");
        const rect = footer.getBoundingClientRect();
        const main = document.querySelector("#main-content");
        const last = main.getBoundingClientRect().bottom;
        return {
          gap: window.innerHeight - rect.bottom,
          // The bar must never cover the end of the page.
          contentClear: rect.top - last,
        };
      });
      expect(afterScroll.gap).toBeLessThanOrEqual(1);
      expect(afterScroll.contentClear).toBeGreaterThanOrEqual(0);
    });
  }
});

test.describe("the footer fade", () => {
  const scrolling = [
    "/about/",
    "/no-such-page/",
    `${dev}/writing/`,
    `${dev}/writing/full-article-layout-fixture/`,
    `${dev}/products/`,
  ];

  for (const viewport of [VIEWPORTS.desktop, VIEWPORTS.mobile]) {
    for (const route of scrolling) {
      test(`${route} softens the text above the fixed bar and ends clear of it at ${viewport.width}px`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.goto(route);
        await settle(page);
        await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" }));

        const state = await page.evaluate(() => {
          const footer = document.querySelector(".site-footer");
          const fade = getComputedStyle(footer, "::before");
          const bar = footer.getBoundingClientRect();
          return {
            height: parseFloat(fade.height),
            position: fade.position,
            pointerEvents: fade.pointerEvents,
            image: fade.backgroundImage,
            // The strip ends where the bar begins.
            bottom: parseFloat(fade.bottom),
            clear: bar.top - document.querySelector("#main-content").getBoundingClientRect().bottom,
          };
        });
        expect(state.height).toBeGreaterThanOrEqual(24);
        expect(state.height).toBeLessThanOrEqual(32);
        expect(state.position).toBe("absolute");
        expect(state.pointerEvents, "the fade takes no input").toBe("none");
        expect(state.image).toContain("linear-gradient");
        // The last line ends above the fade, so it reads at full strength.
        expect(state.clear, "the end of the page clears the fade").toBeGreaterThanOrEqual(state.height);
      });
    }
  }

  test("the homepage has no fade and reserves no room for one", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.goto("/");
    await settle(page);
    const state = await page.evaluate(() => ({
      display: getComputedStyle(document.querySelector(".site-footer"), "::before").display,
      scroll: document.documentElement.scrollHeight - window.innerHeight,
    }));
    expect(state.display).toBe("none");
    expect(state.scroll).toBeLessThanOrEqual(0);
  });
});

test.describe("the footer disclaimer on narrow screens", () => {
  for (const width of [390, 360]) {
    test(`shows the whole disclaimer above the copyright at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 700 });
      await page.goto("/");
      await settle(page);

      const state = await page.evaluate(() => {
        const bar = document.querySelector(".site-footer").getBoundingClientRect();
        const text = document.querySelector(".site-footer__disclaimer");
        const copyright = document.querySelector(".site-footer__copyright").getBoundingClientRect();
        const box = text.getBoundingClientRect();
        return {
          display: getComputedStyle(text).display,
          top: box.top, bottom: box.bottom, left: box.left, right: box.right,
          barTop: bar.top, barBottom: bar.bottom,
          copyrightTop: copyright.top, copyrightBottom: copyright.bottom,
          client: document.documentElement.clientWidth,
          scrollWidth: text.scrollWidth,
          width: text.clientWidth,
        };
      });
      expect(state.display).not.toBe("none");
      expect(state.bottom).toBeGreaterThan(state.top);
      expect(state.top).toBeGreaterThanOrEqual(state.barTop);
      expect(state.copyrightBottom).toBeLessThanOrEqual(state.barBottom + 0.5);
      expect(state.bottom).toBeLessThanOrEqual(state.copyrightTop + 0.5);
      expect(state.left).toBeGreaterThanOrEqual(0);
      expect(state.right).toBeLessThanOrEqual(state.client);
      expect(state.scrollWidth).toBeLessThanOrEqual(state.width);

      // At the end of the page the bar must not cover the content.
      await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" }));
      const clear = await page.evaluate(() =>
        document.querySelector(".site-footer").getBoundingClientRect().top -
        document.querySelector("#main-content").getBoundingClientRect().bottom);
      expect(clear).toBeGreaterThanOrEqual(0);
    });
  }
});

test.describe("the footer items keep apart", () => {
  const SIZES = [
    { width: 1920, height: 1080 },
    { width: 1440, height: 900 },
    { width: 820, height: 1180 },
    { width: 390, height: 844 },
    { width: 360, height: 740 },
  ];
  for (const viewport of SIZES) {
    test(`keeps the disclaimer and the copyright apart at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/");
      await settle(page);
      const boxes = await page.evaluate(() => {
        const plain = (el) => {
          const { left, top, right, bottom } = el.getBoundingClientRect();
          return { left, top, right, bottom };
        };
        return {
          disclaimer: plain(document.querySelector(".site-footer__disclaimer")),
          copyright: plain(document.querySelector(".site-footer__copyright")),
        };
      });
      const stacked = boxes.copyright.top >= boxes.disclaimer.bottom - 0.5;
      if (stacked) {
        // Stacked lines keep a row gap of at least 4px.
        expect(boxes.copyright.top - boxes.disclaimer.bottom).toBeGreaterThanOrEqual(3.5);
      } else {
        expect(boxes.copyright.left - boxes.disclaimer.right).toBeGreaterThanOrEqual(16);
      }
    });
  }
});

test.describe("the compact header", () => {
  // At 640px and below the inline links move into a menu, so the header stays
  // on one row and the wordmark stays beside the button.
  const NARROW = [640, 450, 390, 360];

  for (const width of NARROW) {
    test(`stays on one row with the wordmark and the menu button at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/");
      await settle(page);

      const state = await page.evaluate(() => {
        const header = document.querySelector(".site-header").getBoundingClientRect();
        const brand = document.querySelector(".brand").getBoundingClientRect();
        const wordmark = document.querySelector(".brand__word");
        const toggle = document.querySelector(".navigation-menu__toggle").getBoundingClientRect();
        return {
          headerHeight: header.height,
          wordmarkShown: getComputedStyle(wordmark).display !== "none",
          inlineNavShown: getComputedStyle(document.querySelector(".navigation")).display !== "none",
          overlap: brand.right > toggle.left + 0.5,
          toggleInside: toggle.right <= document.documentElement.clientWidth,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });

      expect(state.headerHeight).toBeLessThanOrEqual(65);
      expect(state.wordmarkShown).toBe(true);
      expect(state.inlineNavShown).toBe(false);
      expect(state.overlap).toBe(false);
      expect(state.toggleInside).toBe(true);
      expect(state.overflow).toBeLessThanOrEqual(1);
    });

    test(`reaches every link through the menu at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/");
      await settle(page);

      const panel = page.locator(".navigation-menu__panel");
      await expect(panel).toBeHidden();
      await page.locator(".navigation-menu__toggle").click();
      await expect(panel).toBeVisible();

      // Production holds about, each section with a published entry, and the three profile links.
      const expected = headerLinks(currentContent);
      const links = panel.getByRole("link");
      await expect(links).toHaveText(expected.map((link) => link.label));
      expect(await links.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")))).toEqual(expected.map((link) => link.href));
      const boxes = await links.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect()));
      for (const box of boxes) {
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(width);
      }
      // The panel opens over the page. It must not change the header height.
      expect(await page.locator(".site-header").evaluate((el) => el.getBoundingClientRect().height)).toBeLessThanOrEqual(65);
    });
  }

  test("opens and closes from the keyboard and shows a focus ring", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto("/");
    await settle(page);

    expect(await tabTo(page, ".navigation-menu__toggle")).toBe(true);
    const ring = await page.locator(".navigation-menu__toggle").evaluate((el) => {
      const style = getComputedStyle(el);
      return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
    });
    expect(ring.style).not.toBe("none");
    expect(ring.width).toBeGreaterThanOrEqual(2);

    await page.keyboard.press("Enter");
    await expect(page.locator(".navigation-menu__panel")).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.locator(".navigation-menu__link").first()).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Space");
    await expect(page.locator(".navigation-menu__panel")).toBeHidden();
  });

  test("closes on Escape and returns focus to the button", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto("/");
    await settle(page);

    expect(await tabTo(page, ".navigation-menu__toggle")).toBe(true);
    await page.keyboard.press("Enter");
    await expect(page.locator(".navigation-menu__panel")).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.locator(".navigation-menu__link").first()).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(page.locator(".navigation-menu__panel")).toBeHidden();
    await expect(page.locator(".navigation-menu__toggle")).toBeFocused();

    // Escape with the menu shut does nothing.
    await page.keyboard.press("Escape");
    await expect(page.locator(".navigation-menu__toggle")).toBeFocused();
    await expect(page.locator(".navigation-menu")).not.toHaveAttribute("open", /.*/);
  });

  // Test focus exit with production content and local preview content.
  for (const [name, url] of [["production", "/"], ["draft", dev + "/"]]) {
    test(`closes when focus tabs past the last link on the ${name} homepage`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 800 });
      await page.goto(url);
      await settle(page);

      expect(await tabTo(page, ".navigation-menu__toggle")).toBe(true);
      await page.keyboard.press("Enter");
      await expect(page.locator(".navigation-menu__panel")).toBeVisible();
      await page.locator(".navigation-menu__link").last().focus();
      await page.keyboard.press("Tab");
      await expect(page.locator(".navigation-menu__panel")).toBeHidden();
      await expect(page.locator(".navigation-menu")).not.toHaveAttribute("open", /.*/);
    });
  }

  test("keeps a gap between the focus ring of the button and the open panel", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto("/");
    await settle(page);

    expect(await tabTo(page, ".navigation-menu__toggle")).toBe(true);
    await page.keyboard.press("Enter");
    await expect(page.locator(".navigation-menu__panel")).toBeVisible();
    const gap = await page.evaluate(() => {
      const toggle = document.querySelector(".navigation-menu__toggle");
      const style = getComputedStyle(toggle);
      const ringBottom = toggle.getBoundingClientRect().bottom + parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth);
      return document.querySelector(".navigation-menu__panel").getBoundingClientRect().top - ringBottom;
    });
    expect(gap, "the ring of the button clears the panel").toBeGreaterThanOrEqual(4);
  });

  test("closes on a click outside the menu and stays open on a click inside", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto("/");
    await settle(page);

    await page.locator(".navigation-menu__toggle").click();
    await expect(page.locator(".navigation-menu__panel")).toBeVisible();
    // A click on the panel padding is inside the menu.
    await page.locator(".navigation-menu__rule").click({ force: true });
    await expect(page.locator(".navigation-menu__panel")).toBeVisible();

    await page.mouse.click(20, 500);
    await expect(page.locator(".navigation-menu__panel")).toBeHidden();
  });

  test("works without JavaScript", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 800 } });
    const page = await context.newPage();
    await page.goto(new URL("/", baseURL).href);
    await page.locator(".navigation-menu__toggle").click();
    const sections = Object.values(currentPublished).filter((entries) => entries.length > 0).length;
    await expect(page.locator(".navigation-menu__panel").getByRole("link")).toHaveCount(4 + sections);
    await context.close();
  });

  test("shows every link inline above the breakpoint", async ({ page }) => {
    await page.setViewportSize({ width: 641, height: 800 });
    await page.goto("/");
    await settle(page);

    const state = await page.evaluate(() => ({
      menuShown: getComputedStyle(document.querySelector(".navigation-menu")).display !== "none",
      height: document.querySelector(".site-header").getBoundingClientRect().height,
      links: [...document.querySelectorAll(".navigation__link")].map((link) => link.getBoundingClientRect().top),
    }));

    expect(state.menuShown).toBe(false);
    expect(state.height).toBeLessThanOrEqual(65);
    expect(new Set(state.links.map(Math.round)).size).toBe(1);
  });

  test("keeps the full nav on one row with every draft link on the dev server", async ({ page }) => {
    // The dev server shows drafts, so its nav holds about, writing, products,
    // and the three profile links: the widest header the site can build.
    await page.setViewportSize({ width: 641, height: 800 });
    await page.goto(dev + "/");
    await settle(page);

    const state = await page.evaluate(() => {
      const brand = document.querySelector(".brand").getBoundingClientRect();
      const nav = document.querySelector(".navigation").getBoundingClientRect();
      return {
        count: document.querySelectorAll(".navigation__link").length,
        height: document.querySelector(".site-header").getBoundingClientRect().height,
        overlap: brand.right > nav.left,
        navInside: nav.right <= document.documentElement.clientWidth,
      };
    });

    expect(state.count).toBe(6);
    expect(state.height).toBeLessThanOrEqual(65);
    expect(state.overlap).toBe(false);
    expect(state.navInside).toBe(true);
  });
});

const DARK_GROUND = "rgb(20, 24, 31)";

test.describe("the 404 page uses the same dark ground as every page", () => {
  test.use({ viewport: VIEWPORTS.desktop });

  test("takes the dark theme, the ink ground, and the reading column", async ({ page }) => {
    await page.goto("/no-such-page/");
    await settle(page);

    await expect(page.locator("meta[name='color-scheme']")).toHaveAttribute("content", "dark");
    await expect(page.locator("meta[name='theme-color']")).toHaveAttribute("content", "#14181F");

    const state = await page.evaluate(() => ({
      body: getComputedStyle(document.body).backgroundColor,
      header: getComputedStyle(document.querySelector(".site-header")).backgroundColor,
      footer: getComputedStyle(document.querySelector(".site-footer")).backgroundColor,
      title: getComputedStyle(document.querySelector("main h1")).color,
      titleLeft: document.querySelector("main h1").getBoundingClientRect().left,
      column: document.querySelector("main .wrap--read").getBoundingClientRect().width,
    }));
    expect(state.body).toBe(DARK_GROUND);
    expect(state.header).toBe(DARK_GROUND);
    expect(state.footer).toBe(DARK_GROUND);
    // Light text on the dark ground.
    expect(state.title).toBe("rgb(234, 237, 242)");
    expect(state.column).toBeLessThanOrEqual(744);

    // The title starts where the about title starts.
    await page.goto("/about/");
    await settle(page);
    const about = await page.locator("main h1").evaluate((el) => el.getBoundingClientRect().left);
    expect(Math.abs(state.titleLeft - about)).toBeLessThanOrEqual(1);
  });
});

/**
 * Left edge of the content in the frame: the header, the intro, and the
 * columns start here. The frame is 960px wide and centred, and 1120px wide from
 * 1600px. Its padding is 32px, or 20px at 760px and below.
 */
const frameLeft = (client) => {
  const pad = client <= 760 ? 20 : 32;
  const frame = client >= 1600 ? 1120 : 960;
  return Math.max(0, (client - frame) / 2) + pad;
};

test.describe("one site frame at every width", () => {
  const WIDE = [
    { width: 1920, height: 1080 },
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
    { width: 1024, height: 768 },
    { width: 820, height: 1180 },
    { width: 390, height: 844 },
  ];
  const ROUTES_IN_FRAME = [
    "/",
    "/about/",
    "/no-such-page/",
    dev + "/",
    dev + "/writing/full-article-layout-fixture/",
    dev + "/products/",
    dev + "/writing/",
  ];

  for (const viewport of WIDE) {
    for (const route of ROUTES_IN_FRAME) {
      test(`${route} starts the logo, the title, and the footer on the frame edge at ${viewport.width}px`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.goto(route);
        await settle(page);

        const edges = await page.evaluate(() => ({
          client: document.documentElement.clientWidth,
          logo: document.querySelector(".brand__mark").getBoundingClientRect().left,
          title: document.querySelector("main h1").getBoundingClientRect().left,
          // Read the bar's own content edge. The disclaimer and the copyright both start there.
          footer: (() => {
            const bar = document.querySelector(".site-footer__inner");
            return bar.getBoundingClientRect().left + parseFloat(getComputedStyle(bar).paddingLeft);
          })(),
        }));
        const expected = frameLeft(edges.client);
        for (const [name, left] of Object.entries({ logo: edges.logo, title: edges.title, footer: edges.footer })) {
          expect(Math.abs(left - expected), `${name} at ${left}, frame at ${expected}`).toBeLessThanOrEqual(1);
        }
      });
    }
  }

  test("keeps the reading column on the frame edge and under 745px on a wide screen", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    for (const route of ["/about/", dev + "/writing/full-article-layout-fixture/"]) {
      await page.goto(route);
      await settle(page);
      const column = await page.evaluate(() => {
        const title = document.querySelector("main h1").getBoundingClientRect();
        return { title: title.left, client: document.documentElement.clientWidth };
      });
      expect(Math.abs(column.title - frameLeft(column.client)), route).toBeLessThanOrEqual(1);
    }
    await page.goto("/about/");
    const read = await page.locator("main .wrap--read").first().evaluate((el) => {
      const box = el.getBoundingClientRect();
      return { width: box.width, left: box.left + parseFloat(getComputedStyle(el).paddingLeft) };
    });
    expect(read.width).toBeLessThanOrEqual(744);
    expect(Math.abs(read.left - frameLeft(1920))).toBeLessThanOrEqual(1);
  });

  test("keeps the header and the home page on one gutter at tablet width", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/");
    await settle(page);
    const edges = await page.evaluate(() => ({
      logo: document.querySelector(".brand__mark").getBoundingClientRect().left,
      title: document.querySelector("main h1").getBoundingClientRect().left,
    }));
    expect(Math.abs(edges.logo - edges.title)).toBeLessThanOrEqual(1);
  });
});

test.describe("the header holds still between short and long pages", () => {
  // Headless Chromium hides scrollbars by default, which makes this check
  // pass for free. This group starts its own browser that keeps them, so a
  // long page really takes the space.
  let browser;
  let page;

  test.beforeAll(async ({ baseURL }, testInfo) => {
    browser = await chromium.launch({ ignoreDefaultArgs: ["--hide-scrollbars"] });
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 700 } });
    page = await context.newPage();
    testInfo.setTimeout(60_000);
  });

  test.afterAll(async () => {
    await browser.close();
  });

  test("keeps the logo and the nav in place when the scrollbar appears", async () => {
    const measure = async (route) => {
      await page.goto(route);
      await settle(page);
      return page.evaluate(() => ({
        overflowY: getComputedStyle(document.documentElement).overflowY,
        overflows: document.documentElement.scrollHeight > document.documentElement.clientHeight,
        client: document.documentElement.clientWidth,
        logo: document.querySelector(".brand__mark").getBoundingClientRect().left,
        nav: document.querySelector(".navigation").getBoundingClientRect().right,
      }));
    };
    const short = await measure("/no-such-page/");
    const long = await measure("/about/");

    // The rule itself holds on every browser, whatever kind of scrollbar it draws.
    expect(short.overflowY).toBe("scroll");
    expect(long.overflowY).toBe("scroll");
    expect(Math.abs(short.logo - long.logo)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(short.nav - long.nav)).toBeLessThanOrEqual(0.5);

    // Classic scrollbars take width. Overlay scrollbars take none, so no gutter exists to measure.
    const gutter = await page.evaluate(() => {
      const box = document.createElement("div");
      box.style.cssText = "width:100px;height:100px;overflow:scroll;position:absolute;visibility:hidden";
      document.body.append(box);
      const width = box.offsetWidth - box.clientWidth;
      box.remove();
      return width;
    });
    if (gutter === 0) {
      test.info().annotations.push({
        type: "skip-reason",
        description: "overlay scrollbars: no gutter to measure",
      });
      return;
    }
    expect(short.overflows).toBe(false);
    expect(long.overflows).toBe(true);
    expect(long.client).toBeLessThan(1440);
    expect(short.client).toBe(long.client);
  });

  test("keeps the footer and the pages free of sideways overflow", async () => {
    for (const route of ["/", "/about/", "/no-such-page/"]) {
      await page.goto(route);
      await settle(page);
      const state = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        footerRight: document.querySelector(".site-footer").getBoundingClientRect().right,
        client: document.documentElement.clientWidth,
      }));
      expect(state.overflow, route).toBeLessThanOrEqual(1);
      expect(state.footerRight, route).toBeLessThanOrEqual(state.client + 1);
    }
  });
});

test.describe("the desktop nav targets", () => {
  test.use({ viewport: VIEWPORTS.desktop });

  test("give every link a 40px tall target and at least 24px width", async ({ page }) => {
    await page.goto(dev + "/");
    await settle(page);
    const links = await page.locator(".navigation__link").evaluateAll((nodes) => nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return { name: node.textContent, width: box.width, height: box.height, left: box.left, right: box.right };
    }));
    expect(links).toHaveLength(6);
    for (const link of links) {
      expect(link.height, link.name).toBeGreaterThanOrEqual(40);
      expect(link.width, link.name).toBeGreaterThanOrEqual(24);
    }
    // Targets do not overlap.
    for (let i = 1; i < links.length; i += 1) expect(links[i].left).toBeGreaterThanOrEqual(links[i - 1].right);
  });

  test("centres the divider in the gap between the internal and profile links", async ({ page }) => {
    await page.goto(dev + "/");
    await settle(page);
    const state = await page.evaluate(() => {
      const divided = document.querySelector(".navigation__link--divided");
      const next = divided.nextElementSibling;
      const from = divided.getBoundingClientRect().right;
      const line = getComputedStyle(divided, "::after");
      const width = parseFloat(line.width);
      return {
        middle: (from + next.getBoundingClientRect().left) / 2,
        centre: from - parseFloat(line.right) - width / 2,
        width,
      };
    });
    // The centre of the line is the centre of the space between the two targets.
    expect(Math.abs(state.centre - state.middle)).toBeLessThanOrEqual(0.5);
    expect(state.width).toBe(1);
  });

  test("leaves equal visible space around every word and the divider", async ({ page }) => {
    await page.goto(dev + "/");
    await settle(page);
    const words = await page.evaluate(() => [...document.querySelectorAll(".navigation__link")].map((link) => {
      const range = document.createRange();
      range.selectNodeContents(link);
      const box = range.getBoundingClientRect();
      return { name: link.textContent, left: box.left, right: box.right, divided: link.classList.contains("navigation__link--divided") };
    }));
    const gaps = words.slice(1).map((word, index) => word.left - words[index].right);
    // Every word pair shares one visible space, the divider pair included once
    // the divider's own space is taken out.
    const at = words.findIndex((word) => word.divided);
    const plain = gaps.filter((_, index) => index !== at);
    for (const gap of plain) expect(Math.abs(gap - plain[0]), plain.join(",")).toBeLessThanOrEqual(1);

    // The divider has the same space on each side as two words have between them.
    const divider = await page.evaluate(() => {
      const link = document.querySelector(".navigation__link--divided");
      const line = getComputedStyle(link, "::after");
      const box = link.getBoundingClientRect();
      return { x: box.right - parseFloat(line.right) };
    });
    expect(Math.abs(divider.x - 1 - words[at].right - plain[0])).toBeLessThanOrEqual(1);
    expect(Math.abs(words[at + 1].left - divider.x - plain[0])).toBeLessThanOrEqual(1);
  });
});

/* The dev server holds the draft article, so that route needs the dev origin.
   The homepage is one screen with no scrolling, so its header does not stick. */
const STICKY_PAGES = [
  ["about", "/about/"],
  ["article", dev + "/writing/full-article-layout-fixture/"],
];

test.describe("the sticky header", () => {
  test("leaves the screen with the homepage when a short screen scrolls", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 390 });
    await page.goto("/");
    await settle(page);
    await page.evaluate(() => window.scrollTo({ top: 120, behavior: "instant" }));
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBeGreaterThan(60);
    const top = await page.evaluate(() => document.querySelector(".site-header").getBoundingClientRect().top);
    expect(top).toBeLessThan(-40);
  });

  for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
    test(`does not stick to the top on the homepage at ${viewportName} width`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/");
      await settle(page);

      const header = await page.evaluate(() => {
        const element = document.querySelector(".site-header");
        const style = getComputedStyle(element);
        return { position: style.position };
      });
      expect(header.position).not.toBe("sticky");
      expect(header.position).not.toBe("fixed");
    });

    for (const [pageName, url] of STICKY_PAGES) {
      test(`stays at the top with an opaque ground on ${pageName} at ${viewportName} width`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.goto(url);
        await settle(page);

        await page.evaluate(() => window.scrollTo({ top: 600, behavior: "instant" }));
        await expect
          .poll(() => page.evaluate(() => Math.round(window.scrollY)))
          .toBeGreaterThan(300);

        const header = await page.evaluate(() => {
          const element = document.querySelector(".site-header");
          const box = element.getBoundingClientRect();
          const ground = getComputedStyle(element).backgroundColor;
          const alpha = ground.startsWith("rgba") ? Number(ground.split(",")[3].replace(")", "")) : 1;
          return { top: box.top, bottom: box.bottom, alpha, position: getComputedStyle(element).position };
        });

        expect(header.position).toBe("sticky");
        expect(header.top).toBeCloseTo(0, 0);
        expect(header.bottom).toBeGreaterThan(40);
        expect(header.alpha).toBe(1);

        // The element under the header's midpoint must be the header, so page
        // text cannot show through it.
        const covered = await page.evaluate(() => {
          const element = document.querySelector(".site-header");
          const box = element.getBoundingClientRect();
          return element.contains(document.elementFromPoint(box.left + 4, box.top + box.height / 2));
        });
        expect(covered).toBe(true);
      });
    }
  }
});

/**
 * The faint grid in the empty area right of the reading column.
 *
 * The test hides the header, the page content, and the footer.
 * The screenshot contains only the ground and the grid.
 * A pixel that differs from the ground belongs to the grid.
 * Decode it in Node to avoid a large browser transfer.
 */
const MOTIF_DEV = dev;
const MOTIF_ROUTES = ["/about/", "/no-such-page/", `${MOTIF_DEV}/products/`, `${MOTIF_DEV}/products/product-layout-fixture/`];
const MOTIF_GROUND = [20, 24, 31];

/** Screenshot the page with only the ground and the grid visible. */
async function gridPixels(page) {
  await page.evaluate(() => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(
      ".site-header, main, .site-footer, .skip-link, astro-dev-toolbar { visibility: hidden !important; }",
    );
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  });
  const { data, info } = await sharp(await page.screenshot())
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, pixels: data };
}

/** Largest channel difference from the ground inside a box. Columns sum up for the line test. */
function gridIn(shot, box) {
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(shot.width, Math.ceil(box.x + box.w));
  const y1 = Math.min(shot.height, Math.ceil(box.y + box.h));
  let peak = 0;
  const columns = new Map();
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const at = (y * shot.width + x) * 4;
      const diff = Math.max(...MOTIF_GROUND.map((value, i) => Math.abs(shot.pixels[at + i] - value)));
      peak = Math.max(peak, diff);
      columns.set(x, (columns.get(x) ?? 0) + diff);
    }
  }
  return { peak, columns };
}

test.describe("the blueprint grid right of the reading column", () => {
  test.use({ viewport: VIEWPORTS.desktop });

  for (const route of MOTIF_ROUTES) {
    test(`${route} shows a grid on the right and none behind text, bars, or edges at 1440px`, async ({ page }) => {
      await page.goto(route);
      await settle(page);
      const { width, height } = VIEWPORTS.desktop;
      const column = await page.locator("main .wrap--read").first().evaluate((el) => el.getBoundingClientRect().right);
      const text = await textBoxes(page);
      const bar = await page.evaluate(() => {
        const fade = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--footer-fade"));
        return document.querySelector(".site-footer").getBoundingClientRect().height + fade;
      });
      const shot = await gridPixels(page);

      // Nothing behind any text box, and nothing anywhere left of the column edge.
      expect(text.length).toBeGreaterThan(0);
      for (const box of text) {
        expect(gridIn(shot, { x: box.x - 8, y: box.y - 8, w: box.w + 16, h: box.h + 16 }).peak).toBeLessThanOrEqual(1);
      }
      expect(gridIn(shot, { x: 0, y: 0, w: column, h: height }).peak, "no grid under the column").toBeLessThanOrEqual(1);

      // Nothing at the viewport edges, behind the header, or behind the footer and its fade.
      expect(gridIn(shot, { x: 0, y: 0, w: width, h: 64 }).peak, "header").toBeLessThanOrEqual(1);
      expect(gridIn(shot, { x: 0, y: height - bar, w: width, h: bar }).peak, "footer").toBeLessThanOrEqual(1);
      expect(gridIn(shot, { x: width - 3, y: 0, w: 3, h: height }).peak, "right edge").toBeLessThanOrEqual(1);
      expect(gridIn(shot, { x: 0, y: 0, w: 3, h: height }).peak, "left edge").toBeLessThanOrEqual(1);

      // A visible, but faint, grid in the right area.
      const right = gridIn(shot, { x: column, y: 64, w: width - column, h: height - 64 - bar });
      expect(right.peak, "the grid shows").toBeGreaterThanOrEqual(6);
      expect(right.peak, "the grid stays fainter than the homepage grid").toBeLessThanOrEqual(26);

      // The strongest vertical line sits on a homepage line position.
      const strongest = [...right.columns.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const offset = (((strongest - frameLeft(width)) % 40) + 40) % 40;
      expect(Math.min(offset, 40 - offset)).toBeLessThanOrEqual(1);
    });

    test(`${route} shows no grid at 390px and 1024px`, async ({ page }) => {
      for (const size of [VIEWPORTS.mobile, { width: 1024, height: 768 }]) {
        await page.setViewportSize(size);
        await page.goto(route);
        await settle(page);
        const shot = await gridPixels(page);
        expect(gridIn(shot, { x: 0, y: 0, w: size.width, h: size.height }).peak, `${size.width}px`).toBeLessThanOrEqual(1);
      }
    });
  }

  test("the grid layer is a fixed pseudo-element that takes no input", async ({ page }) => {
    await page.goto("/about/");
    const layer = await page.evaluate(() => {
      const style = getComputedStyle(document.body, "::before");
      return { position: style.position, pointerEvents: style.pointerEvents, content: style.content };
    });
    expect(layer.position).toBe("fixed");
    expect(layer.pointerEvents).toBe("none");
    expect(layer.content).toBe('""');
  });

  for (const route of ["/", `${MOTIF_DEV}/writing/`, `${MOTIF_DEV}/writing/full-article-layout-fixture/`]) {
    test(`${route} has no grid layer from this rule`, async ({ page }) => {
      await page.goto(route);
      await settle(page);
      const content = await page.evaluate(() => getComputedStyle(document.body, "::before").content);
      expect(content).toBe("none");
    });
  }
});

test.describe("page headers", () => {

  async function headerMetrics(page, url, eyebrow, heading) {
    await page.goto(url);
    await settle(page);
    return page.evaluate(([eyebrowSelector, headingSelector]) => ({
      eyebrowTop: document.querySelector(eyebrowSelector).getBoundingClientRect().top,
      fontSize: parseFloat(getComputedStyle(document.querySelector(headingSelector)).fontSize),
    }), [eyebrow, heading]);
  }

  test("the writing header matches the about header at 1440px", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    const about = await headerMetrics(page, "/about/", ".about .eyebrow", "#about-title");
    const writing = await headerMetrics(page, `${dev}/writing/`, ".writing-index__introduction .eyebrow", "#writing-title");
    expect(Math.abs(writing.eyebrowTop - about.eyebrowTop)).toBeLessThanOrEqual(2);
    expect(Math.abs(writing.fontSize - about.fontSize)).toBeLessThanOrEqual(2);
  });

  // The seven screens of the homepage suite. Home and About must start their title in one place.
  const HEAD_SCREENS = [
    { width: 1920, height: 1080 },
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
    { width: 1024, height: 768 },
    { width: 820, height: 1180 },
    { width: 390, height: 844 },
    { width: 360, height: 740 },
  ];

  /**
   * Read the eyebrow, the title, and the graphic band of the open page. "Room" is the space between
   * the eyebrow and what sits above it: the graphic band when the page flows one in, and the header
   * otherwise. Under 1100px both pages put a band above the title. The inner pages call it
   * [data-graphic], and the homepage holds its globe in .hero__globe.
   */
  const headPosition = (page, eyebrow, title, bandSelector) =>
    page.evaluate(([eyebrowSelector, titleSelector, bandQuery]) => {
      const box = (selector) => document.querySelector(selector).getBoundingClientRect();
      const band = document.querySelector(bandQuery);
      const inFlow = band && getComputedStyle(band).display !== "none" && getComputedStyle(band).position !== "fixed";
      const above = inFlow ? box(bandQuery).bottom : box(".site-header").bottom;
      const style = getComputedStyle(document.querySelector(titleSelector));
      return {
        eyebrowTop: box(eyebrowSelector).top,
        titleTop: box(titleSelector).top,
        room: box(eyebrowSelector).top - above,
        fontSize: parseFloat(style.fontSize),
        band: inFlow ? (({ left, top, width, height }) => ({ left, top, width, height }))(box(bandQuery)) : null,
      };
    }, [eyebrow, title, bandSelector]);

  for (const screen of HEAD_SCREENS) {
    test(`the home intro starts where the About header starts at ${screen.width}x${screen.height}`, async ({ page }) => {
      await page.setViewportSize(screen);
      await page.goto("/about/");
      await settle(page);
      if (screen.width < 1100) await expect(page.locator("[data-graphic='about']")).toHaveAttribute("data-ready", "true");
      const about = await headPosition(page, ".about .eyebrow", ".about__title", "[data-graphic]");
      await page.goto("/");
      await settle(page);
      if (screen.width < 1100) await expect(page.locator("[data-lyra-globe]")).toHaveAttribute("data-ready", "true");
      const home = await headPosition(page, ".hero .eyebrow", ".hero__name", screen.width < 1100 ? ".hero__globe" : "[data-graphic]");

      expect(home.fontSize).toBe(about.fontSize);
      // The room above the eyebrow is the same rule on both pages.
      expect(Math.abs(home.room - about.room)).toBeLessThanOrEqual(1);
      // The gap from eyebrow to title is the same too.
      expect(Math.abs(home.titleTop - home.eyebrowTop - (about.titleTop - about.eyebrowTop))).toBeLessThanOrEqual(1);
      // The two pages match in y at every width.
      expect(Math.abs(home.eyebrowTop - about.eyebrowTop), "the eyebrow top").toBeLessThanOrEqual(1);
      expect(Math.abs(home.titleTop - about.titleTop), "the name top").toBeLessThanOrEqual(1);
      // Below 1100px both pages hold a band, and the two bands have one box.
      if (screen.width < 1100) {
        expect(home.band, "the homepage holds a band").not.toBeNull();
        expect(about.band, "the About page holds a band").not.toBeNull();
        for (const key of ["left", "top", "width", "height"]) {
          expect(Math.abs(home.band[key] - about.band[key]), `the band ${key}`).toBeLessThanOrEqual(1);
        }
      } else {
        expect(home.band, "no band from 1100px").toBeNull();
      }
    });
  }

  test("the writing article count sits under the heading", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.goto(`${dev}/writing/`);
    await settle(page);
    const boxes = await page.evaluate(() => ({
      heading: document.querySelector("#writing-title").getBoundingClientRect().bottom,
      count: document.querySelector(".writing-index__count").getBoundingClientRect().top,
    }));
    expect(boxes.count).toBeGreaterThanOrEqual(boxes.heading);
  });
});

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test(`the name highlight bar sits below the descender of the g at ${name} width`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/about/");
    await settle(page);
    const gap = await page.evaluate(() => {
      const mark = document.querySelector(".about__title .highlight");
      const style = getComputedStyle(mark);
      // A zero-size inline-block marks the baseline of the text.
      const probe = document.createElement("span");
      probe.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
      mark.append(probe);
      const baseline = probe.getBoundingClientRect().bottom;
      probe.remove();
      const context = document.createElement("canvas").getContext("2d");
      context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const descent = context.measureText("g").actualBoundingBoxDescent;
      const barHeight = parseFloat(style.backgroundSize.split(" ")[1]);
      const box = mark.getBoundingClientRect();
      const barTop = box.top + (box.height - barHeight) * (parseFloat(style.backgroundPositionY) / 100);
      return barTop - (baseline + descent);
    });
    expect(gap).toBeGreaterThanOrEqual(0);
  });
}

/**
 * The page graphic sits in one place on every inner page. A visitor who switches pages must see
 * the picture stay still. These pages once placed it by their own rules, so the gap between the
 * words and the picture changed from page to page.
 */
const GRAPHIC_PAGES = [
  { name: "about", url: "/about/", graphic: "[data-graphic='about']" },
  { name: "writing", url: `${MOTIF_DEV}/writing/`, graphic: "[data-graphic='writing']" },
  { name: "products", url: `${MOTIF_DEV}/products/`, graphic: "[data-graphic='products']" },
  { name: "product detail", url: `${MOTIF_DEV}/products/product-layout-fixture/`, graphic: "[data-graphic='products']" },
  { name: "404", url: "/no-such-page/", graphic: "[data-graphic='404']" },
];
/** The shared inset of the figure inside its box. It is FIGURE_INSET in src/shared/page-graphics/inset.ts. */
const FIGURE_INSET = 32;

/** Read the box, the column edges, and the figure bound of the graphic on the open page. */
function readGraphic(page, selector) {
  return page.evaluate((target) => {
    const root = document.querySelector(target);
    const box = root.getBoundingClientRect();
    const rootStyle = getComputedStyle(document.documentElement);
    const frame = parseFloat(rootStyle.getPropertyValue("--frame"));
    const reading = parseFloat(rootStyle.getPropertyValue("--reading-column"));
    const read = document.querySelector("main .wrap--read");
    const header = document.querySelector(".site-header").getBoundingClientRect();
    return {
      left: box.left,
      right: box.right,
      top: box.top,
      bottom: box.bottom,
      gap: parseFloat(rootStyle.getPropertyValue("--graphic-gap")),
      // Every page owes the same column edge. The writing list is narrower, so it uses the frame.
      columnRight: Math.max(0, (innerWidth - frame) / 2) + reading,
      readRight: read ? read.getBoundingClientRect().right : null,
      figureLeft: Number(root.dataset.figureLeft),
      headerBottom: header.bottom,
      position: getComputedStyle(root).position,
    };
  }, selector);
}

test.describe("the page graphic keeps one place on every inner page", () => {
  for (const width of [1920, 1440, 1280, 1100]) {
    test(`shares one box, one gap, and one figure inset at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const found = [];
      for (const target of GRAPHIC_PAGES) {
        await page.goto(target.url);
        await expect(page.locator(target.graphic)).toHaveAttribute("data-ready", "true");
        await settle(page);
        found.push({ name: target.name, ...(await readGraphic(page, target.graphic)) });
      }
      const [first] = found;
      expect(first.gap, "the shared gap token is set").toBeGreaterThan(0);
      for (const item of found) {
        expect(item.position, `${item.name} box is fixed`).toBe("fixed");
        expect(Math.abs(item.left - first.left), `${item.name} box left`).toBeLessThanOrEqual(1);
        expect(Math.abs(item.top - first.top), `${item.name} box top`).toBeLessThanOrEqual(1);
        expect(Math.abs(item.bottom - first.bottom), `${item.name} box bottom`).toBeLessThanOrEqual(1);
        expect(Math.abs(item.right - first.right), `${item.name} box right`).toBeLessThanOrEqual(1);
        expect(Math.abs(item.left - (item.columnRight + item.gap)), `${item.name} gap from the column`).toBeLessThanOrEqual(1);
        if (item.readRight !== null) {
          expect(Math.abs(item.left - (item.readRight + item.gap)), `${item.name} gap from the reading column`).toBeLessThanOrEqual(1);
        }
        expect(Math.abs(item.left + item.figureLeft - (first.left + FIGURE_INSET)), `${item.name} figure left`).toBeLessThanOrEqual(2);
      }
    });
  }

  for (const width of [1099, 900, 390]) {
    test(`shares one band x range and one top gap under the header at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const found = [];
      for (const target of GRAPHIC_PAGES) {
        await page.goto(target.url);
        await expect(page.locator(target.graphic)).toHaveAttribute("data-ready", "true");
        await settle(page);
        found.push({ name: target.name, ...(await readGraphic(page, target.graphic)) });
      }
      const [first] = found;
      for (const item of found) {
        expect(item.position, `${item.name} band scrolls with the page`).not.toBe("fixed");
        expect(Math.abs(item.left - first.left), `${item.name} band left`).toBeLessThanOrEqual(1);
        expect(Math.abs(item.right - first.right), `${item.name} band right`).toBeLessThanOrEqual(1);
        expect(Math.abs(item.top - item.headerBottom - (first.top - first.headerBottom)), `${item.name} gap under the header`).toBeLessThanOrEqual(1);
      }
    });
  }
});

/**
 * The homepage globe starts where the graphic of every inner page starts. It once sat 340px to the
 * left of it, so the picture jumped when a visitor moved from Home to About. The sphere is the
 * figure of the globe. The SVG and the canvas draw the same picture, so these tests read the SVG in
 * a page with no JavaScript.
 */
const GLOBE_SCREENS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1100, height: 800 },
];
/** The edge fade of every page graphic, in pixels. It is --fade in home.css. */
const EDGE_FADE = 24;

/** Read the globe box, the sphere, Vega, and the labels of the homepage in a page with no JavaScript. */
async function readPlainGlobe(browser, baseURL, viewport) {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport });
  const plain = await context.newPage();
  await plain.goto(new URL("/", baseURL).href);
  await settle(plain);
  const read = await plain.evaluate(() => {
    const box = document.querySelector("[data-lyra-globe]").getBoundingClientRect();
    const svg = document.querySelector(".lyra-globe__fallback");
    // The sphere is every neuron and the round ring. The tilted ring has a loose box, so it is not counted.
    const sphere = [...svg.querySelectorAll("circle.lyra-globe__node, ellipse.lyra-globe__ring")]
      .filter((el) => el.tagName === "circle" || el.getAttribute("rx") === el.getAttribute("ry"))
      .map((el) => el.getBoundingClientRect());
    const plainBox = ({ left, right, top, bottom }) => ({ left, right, top, bottom });
    return {
      boxLeft: box.left,
      sphereLeft: Math.min(...sphere.map((rect) => rect.left)),
      sphereRight: Math.max(...sphere.map((rect) => rect.right)),
      // The halo of Vega is the one circle with a radius of 18 grid units.
      vegaGlow: plainBox(svg.querySelector('circle[r="18"]').getBoundingClientRect()),
      labels: [...document.querySelectorAll("[data-lyra-globe] text")].map((text) => ({ text: text.textContent, ...plainBox(text.getBoundingClientRect()) })),
      viewport: innerWidth,
    };
  });
  await context.close();
  return read;
}

test.describe("the homepage globe lines up with the inner page graphic", () => {
  for (const screen of GLOBE_SCREENS) {
    test(`shares the box left and the figure inset of About at ${screen.width}px`, async ({ page, browser, baseURL }) => {
      await page.setViewportSize(screen);
      await page.goto("/about/");
      await expect(page.locator("[data-graphic='about']")).toHaveAttribute("data-ready", "true");
      await settle(page);
      const about = await readGraphic(page, "[data-graphic='about']");
      const home = await readPlainGlobe(browser, baseURL, screen);

      expect(Math.abs(home.boxLeft - about.left), "the globe box left is the About graphic box left").toBeLessThanOrEqual(1);
      expect(Math.abs(home.sphereLeft - (about.left + FIGURE_INSET)), "the sphere starts one figure inset inside the box").toBeLessThanOrEqual(2);
    });

    test(`keeps most of the sphere, Vega, and every label clear of the screen edge fade at ${screen.width}px`, async ({ browser, baseURL }) => {
      const home = await readPlainGlobe(browser, baseURL, screen);
      const clearRight = home.viewport - EDGE_FADE;

      const visible = (Math.min(home.viewport, home.sphereRight) - home.sphereLeft) / (home.sphereRight - home.sphereLeft);
      expect(visible, "the screen shows most of the sphere").toBeGreaterThanOrEqual(0.65);
      expect(home.vegaGlow.left, "the halo of Vega starts inside the screen").toBeGreaterThan(0);
      expect(home.vegaGlow.right, "the halo of Vega ends before the fade").toBeLessThanOrEqual(clearRight);
      expect(home.labels.map((label) => label.text)).toContain("VEGA");
      for (const label of home.labels) {
        expect(label.left, `${label.text} starts inside the screen`).toBeGreaterThan(0);
        expect(label.right, `${label.text} ends before the fade`).toBeLessThanOrEqual(clearRight);
      }
    });
  }
});

test.describe("the graphic bands share one height below 1100px", () => {
  const PAGES = {
    products: { url: `${dev}/products/`, graphic: "[data-graphic='products']" },
    notFound: { url: "/no-such-page-for-the-graphic/", graphic: "[data-graphic='404']" },
  };

  for (const size of [{ width: 1024, height: 768 }, { width: 820, height: 1180 }, VIEWPORTS.mobile, { width: 360, height: 740 }, { width: 820, height: 2000 }]) {
    test(`about, products, the 404 page, and the homepage hold the shared band height at ${size.width}x${size.height}`, async ({ page }) => {
      await page.setViewportSize(size);
      const heights = [];
      for (const target of [PAGES.products, PAGES.notFound, { url: `${dev}/about/`, graphic: "[data-graphic='about']" }, { url: "/", graphic: ".hero__globe [data-lyra-globe]" }]) {
        await open(page, target);
        heights.push(await page.locator(target.graphic).evaluate((el) => el.getBoundingClientRect().height));
      }
      for (const height of heights) {
        expect(Math.abs(height - bandHeight(size.height)), `band heights ${heights}`).toBeLessThanOrEqual(1);
      }
    });
  }
});
