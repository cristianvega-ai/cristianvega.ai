import { expect, test } from "@playwright/test";
import { DRAFT_ORIGIN, pageProblems, settle, useReducedMotion, VIEWPORTS } from "./fixtures.mjs";

test.use({ baseURL: DRAFT_ORIGIN });

const article = "/writing/full-article-layout-fixture/";

// Add test content to the browser and run the article setup.
async function loadArticle(page, content, outside = "") {
  const errors = pageProblems(page);
  await useReducedMotion(page);
  await page.goto(article);
  await settle(page);
  await page.locator(".article").evaluate((element, { content, outside }) => {
    element.insertAdjacentHTML("beforeend", content);
    element.insertAdjacentHTML("beforebegin", outside);
  }, { content, outside });
  await page.evaluate(async () => {
    const { setupArticle } = await import("/src/shared/article-interactions.ts");
    setupArticle();
  });
  return errors;
}

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test(`${name} article keeps authored names and supplies missing defaults`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors = await loadArticle(page, `
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
    for (const [selector, label] of [["#default-code", "Code example"], ["#default-diagram", "Diagram"]]) {
      const element = page.locator(selector);
      await expect(element).toHaveAttribute("role", "region");
      await expect(element).toHaveAttribute("tabindex", "0");
      await expect(element).toHaveAttribute("aria-label", label);
      await expect(element).toHaveAccessibleName(label);
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
    expect(errors).toEqual([]);
  });
}

test("article keeps authored code and diagram labels", async ({ page }) => {
  const errors = await loadArticle(page, `
    <div class="prose">
      <pre id="named-code" aria-label="Signal configuration"><code>signal.enable();</code></pre>
      <div id="named-diagram" class="figure__panel" aria-label="Signal path">Signal path</div>
    </div>
  `);
  for (const [selector, label] of [["#named-code", "Signal configuration"], ["#named-diagram", "Signal path"]]) {
    const element = page.locator(selector);
    await expect.soft(element).toHaveAttribute("aria-label", label);
    await expect.soft(element).toHaveAccessibleName(label);
    await expect(element).toHaveAttribute("role", "region");
    await expect(element).toHaveAttribute("tabindex", "0");
  }
  expect(errors).toEqual([]);
});

test("article keeps label references without adding a label", async ({ page }) => {
  const errors = await loadArticle(page, `
    <div class="prose">
      <h2 id="code-name">Signal configuration</h2>
      <pre id="referenced-code" aria-labelledby="code-name"><code>signal.enable();</code></pre>
      <h2 id="diagram-name">Signal path</h2>
      <p id="diagram-detail">With validation</p>
      <div id="referenced-diagram" class="figure__panel" aria-labelledby="diagram-name diagram-detail">Signal path</div>
    </div>
  `);
  for (const [selector, references, label] of [
    ["#referenced-code", "code-name", "Signal configuration"],
    ["#referenced-diagram", "diagram-name diagram-detail", "Signal path With validation"],
  ]) {
    const element = page.locator(selector);
    await expect(element).toHaveAttribute("aria-labelledby", references);
    await expect.soft(element).not.toHaveAttribute("aria-label");
    await expect(element).toHaveAccessibleName(label);
    await expect(element).toHaveAttribute("role", "region");
    await expect(element).toHaveAttribute("tabindex", "0");
  }
  expect(errors).toEqual([]);
});

test("article keeps authored roles and focus order", async ({ page }) => {
  const errors = await loadArticle(page, `
    <div class="prose">
      <a id="before-code" href="#after-code">Before code</a>
      <pre id="manual-code" role="group" tabindex="-1" aria-label="Signal configuration"><code>signal.enable();</code></pre>
      <a id="after-code" href="#before-code">After code</a>
      <div id="first-diagram" class="figure__panel" role="img" tabindex="3" aria-label="Signal path">Signal path</div>
    </div>
  `);
  const code = page.locator("#manual-code");
  const diagram = page.locator("#first-diagram");
  await expect.soft(code).toHaveAttribute("role", "group");
  await expect.soft(code).toHaveAttribute("tabindex", "-1");
  await expect.soft(diagram).toHaveAttribute("role", "img");
  await expect.soft(diagram).toHaveAttribute("tabindex", "3");
  await page.keyboard.press("Tab");
  await expect.soft(diagram).toBeFocused();
  await page.locator("#before-code").focus();
  await page.keyboard.press("Tab");
  await expect.soft(page.locator("#after-code")).toBeFocused();
  await code.focus();
  await expect(code).toBeFocused();
  expect(errors).toEqual([]);
});

test("article leaves content and controls outside its root unchanged", async ({ page }) => {
  const errors = await loadArticle(page, "", `
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
  expect(errors).toEqual([]);
});
