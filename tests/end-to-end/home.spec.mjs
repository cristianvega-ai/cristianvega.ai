import { expect, test } from "@playwright/test";
import { currentContent, currentPublished, DRAFT_ORIGIN as draftOrigin, expectReadablePage, latestWork, navigationLink, pageProblems, paintedPixels, pendingFrames, playFrames, settle, tabTo, useManualFrames, useReducedMotion, VIEWPORTS as viewports } from "../shared/browser-fixtures.mjs";

const globeSelector = "[data-lyra-globe]";

// Desktop places the globe beside the introduction.
// Mobile stacks them and uses the navigation menu.
// The short viewport checks that the footer does not hide the final content.
for (const viewport of [viewports.desktop, viewports.mobile, { width: 360, height: 500 }]) {
  test(`Home shows readable content and a visible globe at ${viewport.width}px`, async ({ page }) => {
    const recordedPageProblems = pageProblems(page);
    await page.setViewportSize(viewport);
    await useReducedMotion(page);
    await page.goto("/");
    await settle(page);
    await expectReadablePage(page);
    await expect(page.locator(".hero__lede, .hero__thesis")).toHaveCount(2);
    await expect(page.locator(".hero__lede")).toBeVisible();
    await expect(page.locator(".hero__thesis")).toBeVisible();
    await expect(page.locator(globeSelector)).toHaveAttribute("data-ready", "true");
    await expect(page.locator(globeSelector)).toHaveAttribute("aria-hidden", "true");
    expect(await paintedPixels(page, globeSelector, 8), "The globe must contain more than 100 foreground pixels").toBeGreaterThan(100);
    const layout = await page.evaluate((selector) => {
      const globeRectangle = document.querySelector(selector).getBoundingClientRect();
      const introduction = document.querySelector(".hero__main").getBoundingClientRect();
      const globeRoot = document.querySelector(selector);
      return {
        globeClearOfIntroduction: globeRectangle.left >= introduction.right - 1 || globeRectangle.bottom <= introduction.top + 1,
        focusableControlCount: globeRoot.querySelectorAll("a, button, input, [tabindex]").length,
        pointerEvents: getComputedStyle(globeRoot).pointerEvents,
        titleClipped: document.querySelector("h1").scrollWidth > document.querySelector("h1").clientWidth,
      };
    }, globeSelector);
    expect(layout.globeClearOfIntroduction, "The globe must stay clear of the introduction").toBe(true);
    expect(layout.focusableControlCount).toBe(0);
    expect(layout.pointerEvents).toBe("none");
    expect(layout.titleClipped).toBe(false);
    await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
    expect(await page.locator(".hero__next").evaluate((list) =>
      list.getBoundingClientRect().bottom <= document.querySelector(".site-footer").getBoundingClientRect().top + 1,
    ), "The footer must stay below the home links").toBe(true);
    expect(recordedPageProblems).toEqual([]);
  });
}

test("Home opens About and returns through the brand link", async ({ page }) => {
  await page.goto("/");
  await navigationLink(page, "about").click();
  await expect(page).toHaveURL(/\/about\/$/);
  await expect(page.locator(".about__profile")).toBeVisible();
  await page.getByRole("link", { name: "Cristian Vega home" }).click();
  await expect(page.locator(".hero__name")).toBeVisible();
});

test("The globe stops requesting frames after its entrance completes", async ({ page }) => {
  await page.setViewportSize(viewports.desktop);
  await useManualFrames(page);
  await page.goto("/");
  await expect(page.locator(globeSelector)).toHaveAttribute("data-motion-state", "playing");
  await playFrames(page, 32);
  const entrancePixelCount = await paintedPixels(page, globeSelector, 8);
  await playFrames(page, 3000);
  await expect(page.locator(globeSelector)).toHaveAttribute("data-motion-state", "still");
  expect(await paintedPixels(page, globeSelector, 8), "The completed globe entrance must increase foreground paint").toBeGreaterThan(entrancePixelCount);
  expect(await pendingFrames(page), "The completed globe entrance must queue no frames").toBe(0);
});

test("The globe draws with no queued frames when reduced motion applies", async ({ page }) => {
  await useManualFrames(page);
  await useReducedMotion(page);
  await page.goto("/");
  await expect(page.locator(globeSelector)).toHaveAttribute("data-motion-state", "still");
  expect(await paintedPixels(page, globeSelector, 8), "The globe must contain foreground paint under reduced motion").toBeGreaterThan(100);
  expect(await pendingFrames(page)).toBe(0);
});

test("Home preserves content, globe fallback, and navigation without JavaScript", async ({ browser, baseURL: baseAddress }) => {
  const browserContext = await browser.newContext({ javaScriptEnabled: false, viewport: viewports.mobile });
  try {
    const page = await browserContext.newPage();
    await page.goto(new URL("/", baseAddress).href);
    await expect(page.locator(`${globeSelector} .lyra-globe__fallback`)).toBeVisible();
    expect(await page.locator(`${globeSelector} path.is-hot`).count(), "The globe fallback must contain foreground paths without JavaScript").toBeGreaterThan(0);
    await expect(page.locator(`${globeSelector} text`).first()).toBeVisible();
    await expectReadablePage(page);
    await navigationLink(page, "about").click();
    await expect(page.locator(".about__profile")).toBeVisible();
  } finally {
    await browserContext.close();
  }
});

test("Home shows links only for published sections", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("main h2")).toHaveCount(0);
  await expect(page.locator("[data-article-identifier], [data-product-identifier]")).toHaveCount(0);
  await expect(page.locator("a[href='#']")).toHaveCount(0);

  const latestWorkItems = page.locator(".hero__next-item");
  const publishedSections = latestWork.map((latestWorkLink) => currentPublished[latestWorkLink.section].length > 0);
  await expect(latestWorkItems).toHaveText(latestWork.map((latestWorkLink, sectionIndex) => publishedSections[sectionIndex] ? `${latestWorkLink.label} →` : latestWorkLink.soon));
  expect(await latestWorkItems.evaluateAll((nodes) => nodes.map((node) => node.dataset.state))).toEqual(publishedSections.map((isPublished) => isPublished ? "live" : "soon"));
  const focusableControlCount = await page.locator(".hero__next").evaluate((list) => list.querySelectorAll("a, button, [tabindex]").length);
  expect(focusableControlCount).toBe(publishedSections.filter(Boolean).length);
  for (const [sectionIndex, latestWorkLink] of latestWork.entries()) {
    await expect(page.locator(`.navigation__link[href='${latestWorkLink.href}'], .navigation-menu__link[href='${latestWorkLink.href}']`)).toHaveCount(publishedSections[sectionIndex] ? 2 : 0);
    await expect(page.locator(`a[href^='/${latestWorkLink.section}']`)).toHaveCount(publishedSections[sectionIndex] ? 3 : 0);
    await expect(latestWorkItems.nth(sectionIndex).locator("a")).toHaveCount(publishedSections[sectionIndex] ? 1 : 0);
    if (publishedSections[sectionIndex]) await expect(latestWorkItems.nth(sectionIndex).locator("a")).toHaveAttribute("href", latestWorkLink.href);
    expect((await request.get(latestWorkLink.href)).status()).toBe(publishedSections[sectionIndex] ? 200 : 404);
    for (const draft of currentContent[latestWorkLink.section].filter((entry) => entry.data.draft)) {
      expect((await request.get(draft.href)).status(), draft.href).toBe(404);
    }
  }
});

test("Home preview links accept keyboard focus and open writing and products", async ({ page }) => {
  const recordedPageProblems = pageProblems(page);
  await useReducedMotion(page);
  await page.goto(draftOrigin + "/");
  await settle(page);
  const writingLink = page.getByRole("link", { name: "Read my latest writing", exact: true });
  const productsLink = page.getByRole("link", { name: "See my latest products", exact: true });
  await expect(writingLink).toHaveAttribute("href", "/writing/");
  await expect(productsLink).toHaveAttribute("href", "/products/");
  expect(await tabTo(page, ".hero__next a[href='/writing/']")).toBe(true);
  expect(await writingLink.evaluate((link) => {
    const linkStyle = getComputedStyle(link);
    return link.matches(":focus-visible") && linkStyle.outlineStyle !== "none" && parseFloat(linkStyle.outlineWidth) >= 2;
  }), "The writing link must show a visible keyboard focus ring").toBe(true);
  await page.keyboard.press("Enter");
  await expect(page.locator("#writing-title")).toBeVisible();
  await page.goto(draftOrigin + "/");
  await productsLink.click();
  await expect(page.locator("#products-title")).toBeVisible();
  expect(recordedPageProblems).toEqual([]);
});
