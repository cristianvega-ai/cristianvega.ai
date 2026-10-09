import { expect, test } from "@playwright/test";

import { DRAFT_ORIGIN, settle, useReducedMotion } from "./fixtures.mjs";

// One type scale runs the whole site. These tests read computed styles, so a
// page that drifts from the scale fails here. Drafts and the writing pages
// exist only on the dev server.
const WIDTHS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
];
// The page, its title, its lede, and its body text.
const PAGES = {
  about: { address: "/about/", heading: ".about__title", lede: ".about__lede", body: ".about__profile p", eyebrow: ".about .eyebrow" },
  writing: { address: "/writing/", heading: ".writing-index__introduction h1", eyebrow: ".writing-index__introduction .eyebrow" },
  products: { address: "/products/", heading: ".product__title", eyebrow: ".product .eyebrow" },
  product: { address: "/products/product-layout-fixture/", heading: ".product__title", lede: ".product__lede", body: ".product__prose p", eyebrow: ".product .eyebrow" },
  notFound: { address: "/nope/", heading: "h1", lede: ".about__lede", eyebrow: ".about .eyebrow" },
  article: { address: "/writing/full-article-layout-fixture/", heading: ".article__title", lede: ".article__description", body: ".prose p", eyebrow: ".article__header .eyebrow" },
  shortArticle: { address: "/writing/short-article-typography-fixture/", heading: ".article__title", lede: ".article__description", eyebrow: ".article__header .eyebrow" },
};

/** Read every type role during one visit to each page. */
async function readTypography(page, viewport) {
  await page.setViewportSize(viewport);
  await useReducedMotion(page);
  const result = {};
  const pages = {
    ...PAGES,
    home: { address: "/", heading: ".hero__name", lede: ".hero__lede", body: ".hero__thesis", eyebrow: ".hero .eyebrow" },
  };
  for (const [name, { address, ...roles }] of Object.entries(pages)) {
    await page.goto(DRAFT_ORIGIN + address);
    await settle(page);
    result[name] = {};
    for (const [role, selector] of Object.entries(roles)) {
      result[name][role] = await page.locator(selector).first().evaluate((element) => {
        const style = getComputedStyle(element);
        const size = parseFloat(style.fontSize);
        return {
          size,
          line: parseFloat(style.lineHeight) / size,
          tracking: style.letterSpacing === "normal" ? 0 : parseFloat(style.letterSpacing) / size,
        };
      });
    }
  }
  return result;
}

for (const viewport of WIDTHS) {
  test(`the site keeps one readable type scale at ${viewport.width}px`, async ({ page }) => {
    const measured = await readTypography(page, viewport);
    const readRole = (role) => Object.fromEntries(Object.entries(PAGES)
      .filter(([, definition]) => definition[role])
      .map(([name]) => [name, measured[name][role]]));
    const titles = readRole("heading");
    const titleSizes = Object.values(titles).map((title) => title.size);
    expect(Object.keys(titles)).toHaveLength(7);
    expect(new Set(titleSizes).size, JSON.stringify(titles)).toBe(1);
    expect(titleSizes[0], "shared page heading size").toBe(viewport.width <= 760 ? 28 : 36);
    for (const [name, title] of Object.entries(titles)) {
      expect(title.tracking, `${name} heading tracking`).toBeLessThan(-0.02);
      expect(title.tracking, `${name} heading tracking`).toBeGreaterThan(-0.03);
      expect(title.line, `${name} heading line height`).toBeLessThanOrEqual(1.15);
    }

    const home = measured.home;
    const about = measured.about;
    expect(home.heading.size, "home heading size matches about").toBe(about.heading.size);
    expect(home.heading.line, "home heading line matches about").toBeCloseTo(about.heading.line, 3);
    expect(home.heading.tracking, "home heading tracking matches about").toBeCloseTo(about.heading.tracking, 3);
    expect(home.lede.size, "home lede size matches about").toBe(about.lede.size);
    expect(home.body.size, "home body size matches about").toBe(about.body.size);
    expect(home.eyebrow.size, "home eyebrow size matches about").toBe(about.eyebrow.size);
    expect(home.eyebrow.tracking, "home eyebrow tracking matches about").toBeCloseTo(about.eyebrow.tracking, 3);

    const body = readRole("body");
    expect(Object.keys(body).sort()).toEqual(["about", "article", "product"]);
    const firstBody = body.about;
    for (const name of ["article", "product"]) {
      expect(body[name].size, `${name} body size matches about`).toBe(firstBody.size);
      expect(body[name].line, `${name} body line height matches about`).toBeCloseTo(firstBody.line, 2);
    }
    expect(firstBody.size, "about body size").toBe(viewport.width <= 760 ? 16 : 17);
    expect(firstBody.line, "about body line height").toBeGreaterThanOrEqual(1.6);
    expect(firstBody.line, "about body line height").toBeLessThanOrEqual(1.8);
    expect(firstBody.tracking, "about body tracking").toBe(0);

    const eyebrows = readRole("eyebrow");
    const firstEyebrow = eyebrows.about;
    for (const [name, other] of Object.entries(eyebrows).filter(([name]) => name !== "about")) {
      expect(other.size, `${name} eyebrow size matches about`).toBe(firstEyebrow.size);
      expect(other.tracking, `${name} eyebrow tracking matches about`).toBeCloseTo(firstEyebrow.tracking, 3);
    }
    expect(firstEyebrow.size, "about eyebrow size").toBeGreaterThanOrEqual(11);

    const ledes = readRole("lede");
    for (const name of ["about", "product", "article"]) {
      expect(titles[name].size, `${name} heading exceeds lede`).toBeGreaterThan(ledes[name].size);
      expect(ledes[name].size, `${name} lede exceeds body`).toBeGreaterThan(body[name].size);
      expect(body[name].size, `${name} body exceeds eyebrow`).toBeGreaterThan(eyebrows[name].size);
    }
    expect(new Set(Object.values(ledes).map((lede) => lede.size)).size, JSON.stringify(ledes)).toBe(1);
  });
}
