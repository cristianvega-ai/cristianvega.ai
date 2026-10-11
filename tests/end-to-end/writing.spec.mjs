import { expect, test } from "@playwright/test";
import { currentContent, currentPublished, DRAFT_ORIGIN, expectReadablePage, focusRingAndFade, navigationLink, pageProblems, pendingFrames, playFrames, settle, tabTo, useManualFrames, useReducedMotion, VIEWPORTS } from "../shared/browser-fixtures.mjs";

const article = "/writing/full-article-layout-fixture/";
const title = "Lorem ipsum dolor sit amet";
const graphic = "[data-graphic='writing']";

// Keep one article with long code and a diagram in both navigation layouts.
for (const viewport of [VIEWPORTS.desktop, VIEWPORTS.mobile]) {
  test(`writing opens an article and returns to the list at ${viewport.width}px`, async ({ page }) => {
    const problems = pageProblems(page);
    await page.setViewportSize(viewport);
    await useReducedMotion(page);
    await page.goto(DRAFT_ORIGIN + "/");
    await navigationLink(page, "writing").click();
    await expect(page.locator("#writing-title")).toBeVisible();
    await page.getByRole("link", { name: title, exact: true }).click();
    await expect(page).toHaveURL(DRAFT_ORIGIN + article);
    await settle(page);
    await expectReadablePage(page);
    await expect(page.locator(".prose pre")).toBeVisible();
    await expect(page.locator(".figure__panel")).toBeVisible();
    await expect(page.locator("link[rel='canonical']")).toHaveAttribute("href", "https://cristianvega.ai" + article);
    await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
    expect(await page.locator("#main-content").evaluate((main) =>
      main.getBoundingClientRect().bottom <= document.querySelector(".site-footer").getBoundingClientRect().top,
    ), "the footer must not hide article content").toBe(true);
    await page.getByRole("link", { name: "← All articles" }).click();
    await expect(page.locator(".article-list__link")).toHaveCount(currentContent.writing.length);
    expect(problems).toEqual([]);
  });
}

test("drafts appear locally and stay unavailable in production", async ({ page, request }) => {
  await page.goto(DRAFT_ORIGIN + "/writing/");
  await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
  await settle(page);
  await expect(page.locator(".article-list__item")).toHaveCount(currentContent.writing.length);
  await expect(page.locator(".draft-label")).toHaveCount(currentContent.writing.filter((entry) => entry.data.draft).length);
  const links = await page.locator(".article-list__link").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")));
  expect(links).toEqual(currentContent.writing.map((entry) => entry.href));
  for (const entry of currentContent.writing) {
    const response = await request.get(entry.href);
    expect(response.status(), entry.href).toBe(entry.data.draft ? 404 : 200);
  }
  const index = await request.get("/writing/");
  expect(index.status()).toBe(currentPublished.writing.length > 0 ? 200 : 404);
});

test("keyboard focus lights an article and opens its article", async ({ page }) => {
  await useReducedMotion(page);
  await page.goto(DRAFT_ORIGIN + "/writing/");
  await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
  await settle(page);
  expect(await tabTo(page, ".article-list__link >> nth=0")).toBe(true);
  const row = page.locator(".article-list__item").first();
  await expect(page.locator(graphic)).toHaveAttribute("data-active-article", await row.getAttribute("data-article-identifier"));
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
  await page.getByRole("link", { name: "← All articles" }).click();
  await expect(page.locator("#writing-title")).toBeVisible();
});

test("article sections and adjacent articles work", async ({ page }) => {
  await useReducedMotion(page);
  await page.goto(DRAFT_ORIGIN + article);
  await expect(page.locator(".prose h2")).toHaveCount(3);
  await expect(page.locator(".prose .pipeline")).toHaveAttribute("role", "img");
  await expect(page.locator(".prose pre")).toHaveAttribute("tabindex", "0");
  await expect(page.locator(".prose pre")).toHaveAttribute("aria-label", "Code example");
  const position = currentContent.writing.findIndex((entry) => entry.href === article);
  const newer = currentContent.writing[position - 1];
  const current = currentContent.writing[position];
  const newerLink = page.locator(".read-next__newer");
  await expect(newerLink).toHaveAttribute("href", newer.href);
  await expect(newerLink.locator("span")).toHaveText(`Newer${newer.data.draft ? " · Draft" : ""} →`);
  await newerLink.click();
  await expect(page.locator("#article-title")).toHaveText(newer.data.title);
  const olderLink = page.locator(`.read-next a[href='${article}']`);
  await expect(olderLink.locator("span")).toHaveText(`← Older${current.data.draft ? " · Draft" : ""}`);
  await olderLink.click();
  await expect(page.locator("#article-title")).toHaveText(title);
});

test("content and links work without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: VIEWPORTS.mobile });
  const page = await context.newPage();
  await page.goto(DRAFT_ORIGIN + "/writing/");
  await page.getByRole("link", { name: title, exact: true }).click();
  await expect(page.locator("#article-title")).toHaveText(title);
  await expect(page.locator(".prose h2")).toHaveCount(3);
  await expect(page.locator(".prose pre")).toContainText("LoremIpsum");
  await expect(page.locator("[data-graphic]")).toHaveCount(0);
  await page.getByRole("link", { name: "← All articles" }).click();
  await expect(page.locator(".article-list__link")).toHaveCount(currentContent.writing.length);
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
  await page.goto(DRAFT_ORIGIN + article);
  await expect(page.locator("#article-title")).toBeVisible();
  await expect(page.locator("#article-title")).toHaveCSS("opacity", "1");
  await expect(page.locator(".prose h2")).toHaveCount(3);
  await expect(page.locator("[data-graphic]")).toHaveCount(0);
  await page.getByRole("link", { name: "← All articles" }).click();
  await expect(page.locator(".article-list__link")).toHaveCount(currentContent.writing.length);
  // With no canvas, the graphic hides itself and the list stays.
  await expect(page.locator(graphic)).toBeHidden();
});

test("cancels its frames and its listeners on pagehide, and sets up again on a restored page", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await useManualFrames(page);
    await page.goto(DRAFT_ORIGIN + "/writing/");
    await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
    await playFrames(page, 3000);
    await page.locator(".article-list__item").nth(1).hover();
    await expect(page.locator(graphic)).toHaveAttribute("data-active-article", /.+/);
    expect(await pendingFrames(page)).toBe(1);

    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
    expect(await pendingFrames(page), "no frame stays queued after pagehide").toBe(0);
    await expect(page.locator(graphic)).not.toHaveAttribute("data-ready", /.*/);
    await expect(page.locator(graphic)).not.toHaveAttribute("data-motion-state", /.*/);
    await expect(page.locator(graphic)).not.toHaveAttribute("data-active-article", /.*/);
    // The listeners are gone: an article that takes the pointer lights nothing.
    await page.locator(".article-list__item").nth(2).hover();
    await expect(page.locator(graphic)).not.toHaveAttribute("data-active-article", /.*/);
    expect(await pendingFrames(page)).toBe(0);

    // The entrance is over, so a restored page rests with no queued frame. Its listeners return.
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
    expect(await pendingFrames(page), "a restored page at rest queues no frame").toBe(0);
    await page.mouse.move(2, 2);
    await page.locator(".article-list__item").nth(1).hover();
    await expect(page.locator(graphic)).toHaveAttribute("data-active-article", /.+/);
    expect(await pendingFrames(page), "a lit article asks for frames after a restored page").toBe(1);
  });

test("reduced motion draws a lit article at once and runs no frame", async ({ page }) => {
    await useManualFrames(page);
    await useReducedMotion(page);
    await page.goto(DRAFT_ORIGIN + "/writing/");
    await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
    const canvas = page.locator(`${graphic} canvas`);
    const rest = await canvas.evaluate((element) => element.toDataURL());
    await page.locator(".article-list__item").nth(1).hover();
    await expect(page.locator(graphic)).toHaveAttribute("data-active-article", /.+/);
    expect(await canvas.evaluate((element) => element.toDataURL()), "the picture changes on the same turn").not.toBe(rest);
    expect(await pendingFrames(page)).toBe(0);
    await page.mouse.move(2, 2);
    expect(await canvas.evaluate((element) => element.toDataURL())).toBe(rest);
  });

test("wide code and diagrams scroll inside the column and show a focus ring", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto(DRAFT_ORIGIN + article);
  await settle(page);

  for (const selector of [".prose pre", ".figure__panel"]) {
    const box = page.locator(selector).first();
    const state = await box.evaluate((element) => {
      const rectangle = element.getBoundingClientRect();
      return {
        overflowX: getComputedStyle(element).overflowX,
        scrolls: element.scrollWidth > element.clientWidth,
        right: rectangle.right,
        client: document.documentElement.clientWidth,
        tabIndex: element.tabIndex,
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
    const ring = await box.evaluate((element) => {
      const style = getComputedStyle(element);
      return { style: style.outlineStyle, width: parseFloat(style.outlineWidth), offset: parseFloat(style.outlineOffset) };
    });
    expect(ring.style, selector).not.toBe("none");
    expect(ring.width, selector).toBeGreaterThanOrEqual(2);
    // Inside the box, so the code block's clipped corners cannot hide it.
    expect(ring.offset, selector).toBeLessThan(0);
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => box.evaluate((element) => element.scrollLeft), { message: selector }).toBeGreaterThan(0);
  }
});

test("article selection responds to the pointer and stops after it leaves", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await useManualFrames(page);
  await page.goto(DRAFT_ORIGIN + "/writing/");
  await expect(page.locator(graphic)).toHaveAttribute("data-ready", "true");
  await playFrames(page, 3000);
  expect(await pendingFrames(page)).toBe(0);
  const row = page.locator(".article-list__item").nth(1);
  await row.hover();
  await expect(page.locator(graphic)).toHaveAttribute("data-active-article", await row.getAttribute("data-writing-entry-identifier"));
  expect(await pendingFrames(page), "a selected article starts its motion").toBe(1);
  await page.mouse.move(2, 2);
  await expect(page.locator(graphic)).not.toHaveAttribute("data-active-article", /.*/);
  await playFrames(page, 2000);
  expect(await pendingFrames(page), "selection motion stops after the pointer leaves").toBe(0);
});

test("the last article control keeps its focus ring visible", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.mobile);
  await useReducedMotion(page);
  await page.goto(DRAFT_ORIGIN + article);
  await settle(page);
  const focusable = "main :is(a[href], button:not([hidden]), [tabindex='0'])";
  expect(await tabTo(page, `${focusable} >> nth=-1`, 80), "the last article control accepts keyboard focus").toBe(true);
  await expect.poll(async () => {
    const { ringBottom, fadeTop } = await focusRingAndFade(page);
    return fadeTop - ringBottom;
  }, { message: "the footer must not cover the last focus ring" }).toBeGreaterThanOrEqual(0);
  const { ringTop } = await focusRingAndFade(page);
  expect(ringTop, "the header must not cover the last focus ring").toBeGreaterThanOrEqual(
    await page.locator(".site-header").evaluate((header) => header.getBoundingClientRect().bottom - 1),
  );
});
