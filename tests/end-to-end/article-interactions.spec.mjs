import { expect, test } from "@playwright/test";
import { DRAFT_ORIGIN as draftOrigin, pageProblems, settle, useReducedMotion, VIEWPORTS as viewports } from "../shared/browser-fixtures.mjs";

test.use({ baseURL: draftOrigin });

const articlePath = "/writing/full-article-layout-fixture/";

// Add test content to the browser and run the article setup.
async function loadArticle(page, articleMarkup, outsideMarkup = "") {
  const recordedPageProblems = pageProblems(page);
  await useReducedMotion(page);
  await page.goto(articlePath);
  await settle(page);
  await page.locator(".article").evaluate((element, { content: articleMarkup, outside: outsideMarkup }) => {
    element.insertAdjacentHTML("beforeend", articleMarkup);
    element.insertAdjacentHTML("beforebegin", outsideMarkup);
  }, { content: articleMarkup, outside: outsideMarkup });
  await page.evaluate(async () => {
    const { setupArticle } = await import("/src/browser/article-interactions.ts");
    setupArticle();
  });
  return recordedPageProblems;
}

test("Article setup supplies default code and diagram names with keyboard access", async ({ page }) => {
    await page.setViewportSize(viewports.mobile);
    const recordedPageProblems = await loadArticle(page, `
      <div class="prose">
        <a id="before-defaults" href="#after-defaults">Before examples</a>
        <pre id="default-code"><code>const signal = 1;</code></pre>
        <div id="default-diagram" class="figure__panel">Signal path</div>
        <a id="after-defaults" href="#before-defaults">After examples</a>
      </div>
    `);
    const authoredDiagram = page.locator(".figure__panel").first();
    await expect.soft(authoredDiagram).toHaveAttribute("aria-label", "Lorem ipsum diagram");
    await expect.soft(authoredDiagram).toHaveAccessibleName("Lorem ipsum diagram");
    for (const [selector, accessibleLabel] of [["#default-code", "Code example"], ["#default-diagram", "Diagram"]]) {
      const element = page.locator(selector);
      await expect(element).toHaveAttribute("role", "region");
      await expect(element).toHaveAttribute("tabindex", "0");
      await expect(element).toHaveAttribute("aria-label", accessibleLabel);
      await expect(element).toHaveAccessibleName(accessibleLabel);
    }
    await page.locator("#before-defaults").focus();
    await page.keyboard.press("Tab");
    await expect(page.locator("#default-code")).toBeFocused();
    await expect(page.locator("#default-code")).toHaveCSS("outline-style", "solid");
    await page.keyboard.press("Tab");
    await expect(page.locator("#default-diagram")).toBeFocused();
    await expect(page.locator("#default-diagram")).toHaveCSS("outline-style", "solid");
    await page.keyboard.press("Tab");
    await expect(page.locator("#after-defaults")).toBeFocused();
    expect(recordedPageProblems).toEqual([]);
  });
test("Article setup preserves authored code and diagram labels", async ({ page }) => {
  const recordedPageProblems = await loadArticle(page, `
    <div class="prose">
      <pre id="named-code" aria-label="Signal configuration"><code>signal.enable();</code></pre>
      <div id="named-diagram" class="figure__panel" aria-label="Signal path">Signal path</div>
    </div>
  `);
  for (const [selector, accessibleLabel] of [["#named-code", "Signal configuration"], ["#named-diagram", "Signal path"]]) {
    const element = page.locator(selector);
    await expect.soft(element).toHaveAttribute("aria-label", accessibleLabel);
    await expect.soft(element).toHaveAccessibleName(accessibleLabel);
    await expect(element).toHaveAttribute("role", "region");
    await expect(element).toHaveAttribute("tabindex", "0");
  }
  expect(recordedPageProblems).toEqual([]);
});

test("Article setup preserves label references without adding an aria-label", async ({ page }) => {
  const recordedPageProblems = await loadArticle(page, `
    <div class="prose">
      <h2 id="code-name">Signal configuration</h2>
      <pre id="referenced-code" aria-labelledby="code-name"><code>signal.enable();</code></pre>
      <h2 id="diagram-name">Signal path</h2>
      <p id="diagram-detail">With validation</p>
      <div id="referenced-diagram" class="figure__panel" aria-labelledby="diagram-name diagram-detail">Signal path</div>
    </div>
  `);
  for (const [selector, labelReferences, accessibleLabel] of [
    ["#referenced-code", "code-name", "Signal configuration"],
    ["#referenced-diagram", "diagram-name diagram-detail", "Signal path With validation"],
  ]) {
    const element = page.locator(selector);
    await expect(element).toHaveAttribute("aria-labelledby", labelReferences);
    await expect.soft(element).not.toHaveAttribute("aria-label");
    await expect(element).toHaveAccessibleName(accessibleLabel);
    await expect(element).toHaveAttribute("role", "region");
    await expect(element).toHaveAttribute("tabindex", "0");
  }
  expect(recordedPageProblems).toEqual([]);
});

test("Article setup preserves authored roles and keyboard focus order", async ({ page }) => {
  const recordedPageProblems = await loadArticle(page, `
    <div class="prose">
      <a id="before-code" href="#after-code">Before code</a>
      <pre id="manual-code" role="group" tabindex="-1" aria-label="Signal configuration"><code>signal.enable();</code></pre>
      <a id="after-code" href="#before-code">After code</a>
      <div id="first-diagram" class="figure__panel" role="img" tabindex="3" aria-label="Signal path">Signal path</div>
    </div>
  `);
  const codeBlock = page.locator("#manual-code");
  const diagramPanel = page.locator("#first-diagram");
  await expect.soft(codeBlock).toHaveAttribute("role", "group");
  await expect.soft(codeBlock).toHaveAttribute("tabindex", "-1");
  await expect.soft(diagramPanel).toHaveAttribute("role", "img");
  await expect.soft(diagramPanel).toHaveAttribute("tabindex", "3");
  await page.keyboard.press("Tab");
  await expect.soft(diagramPanel).toBeFocused();
  await page.locator("#before-code").focus();
  await page.keyboard.press("Tab");
  await expect.soft(page.locator("#after-code")).toBeFocused();
  await codeBlock.focus();
  await expect(codeBlock).toBeFocused();
  expect(recordedPageProblems).toEqual([]);
});

test("Article setup leaves content and controls outside the article root unchanged", async ({ page }) => {
  const recordedPageProblems = await loadArticle(page, "", `
    <div class="prose">
      <pre id="outside-code"><code>signal.enable();</code></pre>
      <div id="outside-diagram" class="figure__panel">Signal path</div>
    </div>
    <button id="outside-copy" type="button" data-copy-link="https://example.com/" hidden>Outside copy</button>
    <span id="outside-status" class="share-status" role="status">Outside status</span>
  `);
  for (const selector of ["#outside-code", "#outside-diagram"]) {
    for (const attribute of ["role", "tabindex", "aria-label"]) {
      await expect.soft(page.locator(selector)).not.toHaveAttribute(attribute);
    }
  }
  await expect.soft(page.locator("#outside-copy")).toBeHidden();
  await expect(page.locator("#outside-status")).toHaveText("Outside status");
  expect(recordedPageProblems).toEqual([]);
});
