import { expect, test } from "@playwright/test";

import { DRAFT_ORIGIN as dev, settle, useReducedMotion } from "./fixtures.mjs";

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
  about: { url: "/about/", h1: ".about__title", lede: ".about__lede", body: ".about__profile p", eyebrow: ".about .eyebrow" },
  writing: { url: "/writing/", h1: ".writing-index__introduction h1", eyebrow: ".writing-index__introduction .eyebrow" },
  products: { url: "/products/", h1: ".product__title", eyebrow: ".product .eyebrow" },
  product: { url: "/products/product-layout-fixture/", h1: ".product__title", lede: ".product__lede", body: ".product__prose p", eyebrow: ".product .eyebrow" },
  notFound: { url: "/nope/", h1: "h1", lede: ".about__lede", eyebrow: ".about .eyebrow" },
  article: { url: "/writing/full-article-layout-fixture/", h1: ".article__title", lede: ".article__description", body: ".prose p", eyebrow: ".article__header .eyebrow" },
  shortArticle: { url: "/writing/short-article-typography-fixture/", h1: ".article__title", lede: ".article__description", eyebrow: ".article__header .eyebrow" },
};

async function measure(page, url, selector) {
  await page.goto(dev + url);
  await settle(page);
  return page.locator(selector).first().evaluate((element) => {
    const style = getComputedStyle(element);
    const size = parseFloat(style.fontSize);
    return {
      size,
      line: parseFloat(style.lineHeight) / size,
      tracking: style.letterSpacing === "normal" ? 0 : parseFloat(style.letterSpacing) / size,
    };
  });
}

/** Read one role on every page that has it, at one width. */
async function readRole(page, viewport, role) {
  await page.setViewportSize(viewport);
  await useReducedMotion(page);
  const result = {};
  for (const [name, spec] of Object.entries(PAGES)) {
    if (spec[role]) result[name] = await measure(page, spec.url, spec[role]);
  }
  return result;
}

for (const viewport of WIDTHS) {
  test(`every page title has one size at ${viewport.width}px`, async ({ page }) => {
    const titles = await readRole(page, viewport, "h1");
    const sizes = Object.values(titles).map((title) => title.size);
    expect(Object.keys(titles)).toHaveLength(7);
    expect(new Set(sizes).size, JSON.stringify(titles)).toBe(1);
    // A calm title: 36px above a phone, 28px on a phone.
    expect(sizes[0]).toBe(viewport.width <= 760 ? 28 : 36);
    if (viewport.width === 1920) expect(sizes[0]).toBeLessThanOrEqual(36);
    // Large type is tight.
    for (const title of Object.values(titles)) {
      expect(title.tracking).toBeLessThan(-0.02);
      expect(title.tracking).toBeGreaterThan(-0.03);
      expect(title.line).toBeLessThanOrEqual(1.15);
    }
  });

  test(`the home name has the type of a page title at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await useReducedMotion(page);
    const name = await measure(page, "/", ".hero__name");
    const title = await measure(page, "/about/", ".about__title");
    // The home name is an h1, so it must match a page title in every measure.
    expect(name.size).toBe(title.size);
    expect(name.size).toBe(viewport.width <= 760 ? 28 : 36);
    expect(name.line).toBeCloseTo(title.line, 3);
    expect(name.tracking).toBeCloseTo(title.tracking, 3);

    // The rest of the intro reads on the same scale as the inner pages.
    const lede = await measure(page, "/", ".hero__lede");
    const thesis = await measure(page, "/", ".hero__thesis");
    const eyebrow = await measure(page, "/", ".hero .eyebrow");
    const aboutLede = await measure(page, "/about/", ".about__lede");
    const aboutBody = await measure(page, "/about/", ".about__profile p");
    const aboutEyebrow = await measure(page, "/about/", ".about .eyebrow");
    expect(lede.size).toBe(aboutLede.size);
    expect(thesis.size).toBe(aboutBody.size);
    expect(eyebrow.size).toBe(aboutEyebrow.size);
    expect(eyebrow.tracking).toBeCloseTo(aboutEyebrow.tracking, 3);
  });

  test(`body text, line height, and the eyebrow agree on every page at ${viewport.width}px`, async ({ page }) => {
    const body = await readRole(page, viewport, "body");
    expect(Object.keys(body).sort()).toEqual(["about", "article", "product"]);
    const [first, ...others] = Object.values(body);
    for (const other of others) {
      expect(other.size).toBe(first.size);
      expect(other.line).toBeCloseTo(first.line, 2);
    }
    // Readable prose: 16px on a phone and 17px above it, at a line height from 1.6 to 1.8.
    expect(first.size).toBe(viewport.width <= 760 ? 16 : 17);
    expect(first.line).toBeGreaterThanOrEqual(1.6);
    expect(first.line).toBeLessThanOrEqual(1.8);
    expect(first.tracking).toBe(0);

    const eyebrow = await readRole(page, viewport, "eyebrow");
    const [firstEyebrow, ...otherEyebrows] = Object.values(eyebrow);
    for (const other of otherEyebrows) {
      expect(other.size).toBe(firstEyebrow.size);
      expect(other.tracking).toBeCloseTo(firstEyebrow.tracking, 3);
    }
    expect(firstEyebrow.size).toBeGreaterThanOrEqual(11);
  });

  test(`the sizes fall in order: title, lede, body, eyebrow at ${viewport.width}px`, async ({ page }) => {
    const titles = await readRole(page, viewport, "h1");
    const ledes = await readRole(page, viewport, "lede");
    const body = await readRole(page, viewport, "body");
    const eyebrows = await readRole(page, viewport, "eyebrow");
    for (const name of ["about", "product", "article"]) {
      expect(titles[name].size).toBeGreaterThan(ledes[name].size);
      expect(ledes[name].size).toBeGreaterThan(body[name].size);
      expect(body[name].size).toBeGreaterThan(eyebrows[name].size);
    }
    // A lede reads the same on every page that has one.
    const sizes = Object.values(ledes).map((lede) => lede.size);
    expect(new Set(sizes).size, JSON.stringify(ledes)).toBe(1);
  });
}
