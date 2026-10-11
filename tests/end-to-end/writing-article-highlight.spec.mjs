import { expect, test } from "@playwright/test";
import { currentContent, DRAFT_ORIGIN as draftOrigin, pendingFrames, playFrames, settle, tabTo, useManualFrames, useReducedMotion, VIEWPORTS as viewports } from "../shared/browser-fixtures.mjs";

const graphicSelector = "[data-graphic='writing']";

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
