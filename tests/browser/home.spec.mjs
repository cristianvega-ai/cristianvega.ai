import { expect, test } from "@playwright/test";
import { currentContent, currentPublished, DRAFT_ORIGIN, expectReadablePage, latestWork, navigationLink, pageProblems, paintedPixels, pendingFrames, playFrames, settle, tabTo, useManualFrames, useReducedMotion, VIEWPORTS } from "./fixtures.mjs";

const globe = "[data-lyra-globe]";

// Desktop separates the picture and intro. Mobile stacks them and uses the menu.
// The short phone checks that the fixed footer cannot hide the last content.
for (const viewport of [VIEWPORTS.desktop, VIEWPORTS.mobile, { width: 360, height: 500 }]) {
  test(`home keeps readable content and a visible globe at ${viewport.width}px`, async ({ page }) => {
    const problems = pageProblems(page);
    await page.setViewportSize(viewport);
    await useReducedMotion(page);
    await page.goto("/");
    await settle(page);
    await expectReadablePage(page);
    await expect(page.locator(".hero__lede, .hero__thesis")).toHaveCount(2);
    await expect(page.locator(".hero__lede")).toBeVisible();
    await expect(page.locator(".hero__thesis")).toBeVisible();
    await expect(page.locator(globe)).toHaveAttribute("data-ready", "true");
    await expect(page.locator(globe)).toHaveAttribute("aria-hidden", "true");
    expect(await paintedPixels(page, globe, 8), "the globe contains foreground paint").toBeGreaterThan(100);
    const layout = await page.evaluate((selector) => {
      const picture = document.querySelector(selector).getBoundingClientRect();
      const introduction = document.querySelector(".hero__main").getBoundingClientRect();
      const root = document.querySelector(selector);
      return {
        apart: picture.left >= introduction.right - 1 || picture.bottom <= introduction.top + 1,
        focusable: root.querySelectorAll("a, button, input, [tabindex]").length,
        pointerEvents: getComputedStyle(root).pointerEvents,
        titleClipped: document.querySelector("h1").scrollWidth > document.querySelector("h1").clientWidth,
      };
    }, globe);
    expect(layout.apart, "the globe must not cover the introduction").toBe(true);
    expect(layout.focusable).toBe(0);
    expect(layout.pointerEvents).toBe("none");
    expect(layout.titleClipped).toBe(false);
    await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
    expect(await page.locator(".hero__next").evaluate((list) =>
      list.getBoundingClientRect().bottom <= document.querySelector(".site-footer").getBoundingClientRect().top + 1,
    ), "the footer must not cover the calls to action").toBe(true);
    expect(problems).toEqual([]);
  });
}

test("home reaches About and returns through the brand link", async ({ page }) => {
  await page.goto("/");
  await navigationLink(page, "about").click();
  await expect(page).toHaveURL(/\/about\/$/);
  await expect(page.locator(".about__profile")).toBeVisible();
  await page.getByRole("link", { name: "Cristian Vega home" }).click();
  await expect(page.locator(".hero__name")).toBeVisible();
});

test("the globe finishes its entrance and stops requesting frames", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await useManualFrames(page);
  await page.goto("/");
  await expect(page.locator(globe)).toHaveAttribute("data-motion-state", "playing");
  await playFrames(page, 32);
  const early = await paintedPixels(page, globe, 8);
  await playFrames(page, 3000);
  await expect(page.locator(globe)).toHaveAttribute("data-motion-state", "still");
  expect(await paintedPixels(page, globe, 8), "the entrance reveals the globe").toBeGreaterThan(early);
  expect(await pendingFrames(page), "the completed globe must stop its clock").toBe(0);
});

test("reduced motion shows the globe without queued frames", async ({ page }) => {
  await useManualFrames(page);
  await useReducedMotion(page);
  await page.goto("/");
  await expect(page.locator(globe)).toHaveAttribute("data-motion-state", "still");
  expect(await paintedPixels(page, globe, 8), "the reduced-motion globe is drawn").toBeGreaterThan(100);
  expect(await pendingFrames(page)).toBe(0);
});

test("home works without JavaScript", async ({ browser, baseURL: baseAddress }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: VIEWPORTS.mobile });
  try {
    const page = await context.newPage();
    await page.goto(new URL("/", baseAddress).href);
    await expect(page.locator(`${globe} .lyra-globe__fallback`)).toBeVisible();
    expect(await page.locator(`${globe} path.is-hot`).count(), "the fallback contains the foreground figure").toBeGreaterThan(0);
    await expect(page.locator(`${globe} text`).first()).toBeVisible();
    await expectReadablePage(page);
    await navigationLink(page, "about").click();
    await expect(page.locator(".about__profile")).toBeVisible();
  } finally {
    await context.close();
  }
});

test("homepage links follow current publication", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("main h2")).toHaveCount(0);
  await expect(page.locator("[data-article-identifier], [data-product-identifier]")).toHaveCount(0);
  await expect(page.locator("a[href='#']")).toHaveCount(0);

  const items = page.locator(".hero__next-item");
  const live = latestWork.map((item) => currentPublished[item.section].length > 0);
  await expect(items).toHaveText(latestWork.map((item, index) => live[index] ? `${item.label} →` : item.soon));
  expect(await items.evaluateAll((nodes) => nodes.map((node) => node.dataset.state))).toEqual(live.map((visible) => visible ? "live" : "soon"));
  const focusable = await page.locator(".hero__next").evaluate((list) => list.querySelectorAll("a, button, [tabindex]").length);
  expect(focusable).toBe(live.filter(Boolean).length);
  for (const [index, item] of latestWork.entries()) {
    await expect(page.locator(`.navigation__link[href='${item.href}'], .navigation-menu__link[href='${item.href}']`)).toHaveCount(live[index] ? 2 : 0);
    await expect(page.locator(`a[href^='/${item.section}']`)).toHaveCount(live[index] ? 3 : 0);
    await expect(items.nth(index).locator("a")).toHaveCount(live[index] ? 1 : 0);
    if (live[index]) await expect(items.nth(index).locator("a")).toHaveAttribute("href", item.href);
    expect((await request.get(item.href)).status()).toBe(live[index] ? 200 : 404);
    for (const draft of currentContent[item.section].filter((entry) => entry.data.draft)) {
      expect((await request.get(draft.href)).status(), draft.href).toBe(404);
    }
  }
});

test("preview calls to action accept keyboard focus and open their sections", async ({ page }) => {
  const problems = pageProblems(page);
  await useReducedMotion(page);
  await page.goto(DRAFT_ORIGIN + "/");
  await settle(page);
  const writing = page.getByRole("link", { name: "Read my latest writing", exact: true });
  const products = page.getByRole("link", { name: "See my latest products", exact: true });
  await expect(writing).toHaveAttribute("href", "/writing/");
  await expect(products).toHaveAttribute("href", "/products/");
  expect(await tabTo(page, ".hero__next a[href='/writing/']")).toBe(true);
  expect(await writing.evaluate((link) => {
    const style = getComputedStyle(link);
    return link.matches(":focus-visible") && style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2;
  }), "the call to action must show keyboard focus").toBe(true);
  await page.keyboard.press("Enter");
  await expect(page.locator("#writing-title")).toBeVisible();
  await page.goto(DRAFT_ORIGIN + "/");
  await products.click();
  await expect(page.locator("#products-title")).toBeVisible();
  expect(problems).toEqual([]);
});
