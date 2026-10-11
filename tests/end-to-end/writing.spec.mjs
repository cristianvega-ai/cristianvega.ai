import { expect, test } from "@playwright/test";
import { currentContent, currentPublished, DRAFT_ORIGIN as draftOrigin, expectReadablePage, focusRingAndFade, navigationLink, pageProblems, pendingFrames, playFrames, settle, tabTo, useManualFrames, useReducedMotion, VIEWPORTS as viewports } from "../shared/browser-fixtures.mjs";

const articlePath = "/writing/full-article-layout-fixture/";
const articleTitle = "Lorem ipsum dolor sit amet";
const graphicSelector = "[data-graphic='writing']";

// Keep one article with long code and a diagram in both navigation layouts.
for (const viewport of [viewports.desktop, viewports.mobile]) {
  test(`Writing opens an article and returns to the list at ${viewport.width}px`, async ({ page }) => {
    const recordedPageProblems = pageProblems(page);
    await page.setViewportSize(viewport);
    await useReducedMotion(page);
    await page.goto(draftOrigin + "/");
    await navigationLink(page, "writing").click();
    await expect(page.locator("#writing-title")).toBeVisible();
    await page.getByRole("link", { name: articleTitle, exact: true }).click();
    await expect(page).toHaveURL(draftOrigin + articlePath);
    await settle(page);
    await expectReadablePage(page);
    await expect(page.locator(".prose pre")).toBeVisible();
    await expect(page.locator(".figure__panel")).toBeVisible();
    await expect(page.locator("link[rel='canonical']")).toHaveAttribute("href", "https://cristianvega.ai" + articlePath);
    await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
    expect(await page.locator("#main-content").evaluate((mainContent) =>
      mainContent.getBoundingClientRect().bottom <= document.querySelector(".site-footer").getBoundingClientRect().top,
    ), "The footer must stay below the article content").toBe(true);
    await page.getByRole("link", { name: "← All articles" }).click();
    await expect(page.locator(".article-list__link")).toHaveCount(currentContent.writing.length);
    expect(recordedPageProblems).toEqual([]);
  });
}

test("Writing drafts appear locally and remain unavailable in production", async ({ page, request }) => {
  await page.goto(draftOrigin + "/writing/");
  await expect(page.locator(graphicSelector)).toHaveAttribute("data-ready", "true");
  await settle(page);
  await expect(page.locator(".article-list__item")).toHaveCount(currentContent.writing.length);
  await expect(page.locator(".draft-label")).toHaveCount(currentContent.writing.filter((articleEntry) => articleEntry.data.draft).length);
  const articleLinks = await page.locator(".article-list__link").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")));
  expect(articleLinks).toEqual(currentContent.writing.map((articleEntry) => articleEntry.href));
  for (const articleEntry of currentContent.writing) {
    const response = await request.get(articleEntry.href);
    expect(response.status(), articleEntry.href).toBe(articleEntry.data.draft ? 404 : 200);
  }
  const writingResponse = await request.get("/writing/");
  expect(writingResponse.status()).toBe(currentPublished.writing.length > 0 ? 200 : 404);
});

test("Writing highlights the focused article and opens it with Enter", async ({ page }) => {
  await useReducedMotion(page);
  await page.goto(draftOrigin + "/writing/");
  await expect(page.locator(graphicSelector)).toHaveAttribute("data-ready", "true");
  await settle(page);
  expect(await tabTo(page, ".article-list__link >> nth=0")).toBe(true);
  const articleRow = page.locator(".article-list__item").first();
  await expect(page.locator(graphicSelector)).toHaveAttribute("data-active-article", await articleRow.getAttribute("data-article-identifier"));
  await expect(articleRow).toHaveCSS("outline-style", "solid");
  await expect(articleRow).toHaveCSS("outline-width", "3px");
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

test("Article sections expose controls and adjacent article links open correctly", async ({ page }) => {
  await useReducedMotion(page);
  await page.goto(draftOrigin + articlePath);
  await expect(page.locator(".prose h2")).toHaveCount(3);
  await expect(page.locator(".prose .pipeline")).toHaveAttribute("role", "img");
  await expect(page.locator(".prose pre")).toHaveAttribute("tabindex", "0");
  await expect(page.locator(".prose pre")).toHaveAttribute("aria-label", "Code example");
  const articleIndex = currentContent.writing.findIndex((articleEntry) => articleEntry.href === articlePath);
  const newerArticle = currentContent.writing[articleIndex - 1];
  const currentArticle = currentContent.writing[articleIndex];
  const newerLink = page.locator(".read-next__newer");
  await expect(newerLink).toHaveAttribute("href", newerArticle.href);
  await expect(newerLink.locator("span")).toHaveText(`Newer${newerArticle.data.draft ? " · Draft" : ""} →`);
  await newerLink.click();
  await expect(page.locator("#article-title")).toHaveText(newerArticle.data.title);
  const olderLink = page.locator(`.read-next a[href='${articlePath}']`);
  await expect(olderLink.locator("span")).toHaveText(`← Older${currentArticle.data.draft ? " · Draft" : ""}`);
  await olderLink.click();
  await expect(page.locator("#article-title")).toHaveText(articleTitle);
});

test("Writing preserves article content and navigation without JavaScript", async ({ browser }) => {
  const browserContext = await browser.newContext({ javaScriptEnabled: false, viewport: viewports.mobile });
  const page = await browserContext.newPage();
  await page.goto(draftOrigin + "/writing/");
  await page.getByRole("link", { name: articleTitle, exact: true }).click();
  await expect(page.locator("#article-title")).toHaveText(articleTitle);
  await expect(page.locator(".prose h2")).toHaveCount(3);
  await expect(page.locator(".prose pre")).toContainText("LoremIpsum");
  await expect(page.locator("[data-graphic]")).toHaveCount(0);
  await page.getByRole("link", { name: "← All articles" }).click();
  await expect(page.locator(".article-list__link")).toHaveCount(currentContent.writing.length);
  await expect(page.locator(graphicSelector)).toHaveCSS("display", "none");
  await browserContext.close();
});

test("Writing preserves readable articles and lists when canvas, fonts, and storage fail", async ({ page }) => {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = () => null;
    Storage.prototype.getItem = () => { throw new Error("Storage blocked"); };
    Storage.prototype.setItem = () => { throw new Error("Storage blocked"); };
  });
  await page.route("**/*.woff2*", (route) => route.abort());
  await page.goto(draftOrigin + articlePath);
  await expect(page.locator("#article-title")).toBeVisible();
  await expect(page.locator("#article-title")).toHaveCSS("opacity", "1");
  await expect(page.locator(".prose h2")).toHaveCount(3);
  await expect(page.locator("[data-graphic]")).toHaveCount(0);
  await page.getByRole("link", { name: "← All articles" }).click();
  await expect(page.locator(".article-list__link")).toHaveCount(currentContent.writing.length);
  // The article list remains visible when the canvas is unavailable.
  await expect(page.locator(graphicSelector)).toBeHidden();
});

test("Writing removes frames and listeners on pagehide and restores them on pageshow", async ({ page }) => {
    await page.setViewportSize(viewports.desktop);
    await useManualFrames(page);
    await page.goto(draftOrigin + "/writing/");
    await expect(page.locator(graphicSelector)).toHaveAttribute("data-ready", "true");
    await playFrames(page, 3000);
    await page.locator(".article-list__item").nth(1).hover();
    await expect(page.locator(graphicSelector)).toHaveAttribute("data-active-article", /.+/);
    expect(await pendingFrames(page)).toBe(1);

    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
    expect(await pendingFrames(page), "Writing must queue no frames after pagehide").toBe(0);
    await expect(page.locator(graphicSelector)).not.toHaveAttribute("data-ready", /.*/);
    await expect(page.locator(graphicSelector)).not.toHaveAttribute("data-motion-state", /.*/);
    await expect(page.locator(graphicSelector)).not.toHaveAttribute("data-active-article", /.*/);
    // Pointer movement must not highlight an article after listener cleanup.
    await page.locator(".article-list__item").nth(2).hover();
    await expect(page.locator(graphicSelector)).not.toHaveAttribute("data-active-article", /.*/);
    expect(await pendingFrames(page)).toBe(0);

    // The restored page must queue no frames after entrance completion.
    // Article listeners must return on pageshow.
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    await expect(page.locator(graphicSelector)).toHaveAttribute("data-ready", "true");
    expect(await pendingFrames(page), "Restored writing must queue no frames while no article is active").toBe(0);
    await page.mouse.move(2, 2);
    await page.locator(".article-list__item").nth(1).hover();
    await expect(page.locator(graphicSelector)).toHaveAttribute("data-active-article", /.+/);
    expect(await pendingFrames(page), "Restored writing must queue frames when an article becomes active").toBe(1);
  });

test("Writing highlights articles immediately with no frames under reduced motion", async ({ page }) => {
    await useManualFrames(page);
    await useReducedMotion(page);
    await page.goto(draftOrigin + "/writing/");
    await expect(page.locator(graphicSelector)).toHaveAttribute("data-ready", "true");
    const canvas = page.locator(`${graphicSelector} canvas`);
    const restingBitmap = await canvas.evaluate((element) => element.toDataURL());
    await page.locator(".article-list__item").nth(1).hover();
    await expect(page.locator(graphicSelector)).toHaveAttribute("data-active-article", /.+/);
    expect(await canvas.evaluate((element) => element.toDataURL()), "The article highlight must change the bitmap immediately under reduced motion").not.toBe(restingBitmap);
    expect(await pendingFrames(page)).toBe(0);
    await page.mouse.move(2, 2);
    expect(await canvas.evaluate((element) => element.toDataURL())).toBe(restingBitmap);
  });

test("Wide article code and diagrams scroll within the column and show keyboard focus", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto(draftOrigin + articlePath);
  await settle(page);

  for (const selector of [".prose pre", ".figure__panel"]) {
    const scrollableBlock = page.locator(selector).first();
    const blockLayout = await scrollableBlock.evaluate((element) => {
      const rectangle = element.getBoundingClientRect();
      return {
        overflowX: getComputedStyle(element).overflowX,
        scrollsHorizontally: element.scrollWidth > element.clientWidth,
        right: rectangle.right,
        viewportWidth: document.documentElement.clientWidth,
        tabIndex: element.tabIndex,
      };
    });
    expect(blockLayout.overflowX, `${selector}: the article block must allow horizontal scrolling`).toBe("auto");
    expect(blockLayout.scrollsHorizontally, `${selector}: the wide article block must contain horizontal overflow`).toBe(true);
    expect(blockLayout.right, `${selector}: the article block must stay inside the viewport right edge`).toBeLessThanOrEqual(blockLayout.viewportWidth);
    expect(blockLayout.tabIndex, `${selector}: the article block must accept keyboard focus`).toBe(0);

    // Check keyboard focus, the focus ring, and horizontal keyboard scrolling.
    await scrollableBlock.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(scrollableBlock).toBeFocused();
    const focusRing = await scrollableBlock.evaluate((element) => {
      const computedStyle = getComputedStyle(element);
      return { outlineStyle: computedStyle.outlineStyle, outlineWidth: parseFloat(computedStyle.outlineWidth), outlineOffset: parseFloat(computedStyle.outlineOffset) };
    });
    expect(focusRing.outlineStyle, `${selector}: the focused article block must show an outline`).not.toBe("none");
    expect(focusRing.outlineWidth, `${selector}: the focus outline width must reach two pixels`).toBeGreaterThanOrEqual(2);
    // Keep the focus ring inside the block to prevent clipping at rounded corners.
    expect(focusRing.outlineOffset, `${selector}: the focus outline must stay inside the article block`).toBeLessThan(0);
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => scrollableBlock.evaluate((element) => element.scrollLeft), { message: `${selector}: the article block must scroll after ArrowRight` }).toBeGreaterThan(0);
  }
});

test("Writing highlights the pointed article and stops motion after the pointer leaves", async ({ page }) => {
  await page.setViewportSize(viewports.desktop);
  await useManualFrames(page);
  await page.goto(draftOrigin + "/writing/");
  await expect(page.locator(graphicSelector)).toHaveAttribute("data-ready", "true");
  await playFrames(page, 3000);
  expect(await pendingFrames(page)).toBe(0);
  const articleRow = page.locator(".article-list__item").nth(1);
  await articleRow.hover();
  await expect(page.locator(graphicSelector)).toHaveAttribute("data-active-article", await articleRow.getAttribute("data-writing-entry-identifier"));
  expect(await pendingFrames(page), "An active writing article must start motion").toBe(1);
  await page.mouse.move(2, 2);
  await expect(page.locator(graphicSelector)).not.toHaveAttribute("data-active-article", /.*/);
  await playFrames(page, 2000);
  expect(await pendingFrames(page), "Writing selection motion must stop after the pointer leaves").toBe(0);
});

test("The last article control keeps its focus ring clear of the header and footer", async ({ page }) => {
  await page.setViewportSize(viewports.mobile);
  await useReducedMotion(page);
  await page.goto(draftOrigin + articlePath);
  await settle(page);
  const focusableSelector = "main :is(a[href], button:not([hidden]), [tabindex='0'])";
  expect(await tabTo(page, `${focusableSelector} >> nth=-1`, 80), "The last article control must accept keyboard focus").toBe(true);
  await expect.poll(async () => {
    const { ringBottom, fadeTop } = await focusRingAndFade(page);
    return fadeTop - ringBottom;
  }, { message: "The last article focus ring must stay above the footer fade" }).toBeGreaterThanOrEqual(0);
  const { ringTop } = await focusRingAndFade(page);
  expect(ringTop, "The last article focus ring must stay below the header").toBeGreaterThanOrEqual(
    await page.locator(".site-header").evaluate((header) => header.getBoundingClientRect().bottom - 1),
  );
});
