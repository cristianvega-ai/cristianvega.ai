import { readFileSync, readdirSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { load, dump } from "js-yaml";

// Share repository paths, publication fixtures, and rendered-page checks.
// Keep helpers used by one suite in that suite.

// Decode the repository file URL to preserve spaces and non-ASCII path characters.
export const root = fileURLToPath(new URL("../..", import.meta.url));
export const dist = join(root, "dist");

// Read Markdown independently from the application content helpers.
export function readContentInventory(projectRoot = root) {
  const inventory = {};
  for (const [section, collection] of [["writing", "writing"], ["products", "products"]]) {
    const contentDirectory = join(projectRoot, "src", "content", collection);
    inventory[section] = readdirSync(contentDirectory).filter((contentFilename) => contentFilename.endsWith(".md")).map((contentFilename) => {
      const markdownSource = readFileSync(join(contentDirectory, contentFilename), "utf8");
      const frontmatterMatch = markdownSource.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
      assert.ok(frontmatterMatch, `${contentFilename} must have YAML frontmatter`);
      const frontmatterData = load(frontmatterMatch[1]);
      frontmatterData.draft ??= true;
      frontmatterData.date = new Date(frontmatterData.date);
      if (section === "products") frontmatterData.status ??= "Product";
      return { id: contentFilename.slice(0, -3), data: frontmatterData, body: markdownSource.slice(frontmatterMatch[0].length), href: `/${section}/${contentFilename.slice(0, -3)}/` };
    });
  }
  // Both collections list the newest entry first and break date ties by id.
  for (const entries of Object.values(inventory)) {
    entries.sort((firstEntry, secondEntry) => secondEntry.data.date - firstEntry.data.date || firstEntry.id.localeCompare(secondEntry.id));
  }
  return inventory;
}

export function publishedContent(inventory = readContentInventory()) {
  return Object.fromEntries(Object.entries(inventory).map(([section, entries]) => [section, entries.filter((entry) => !entry.data.draft)]));
}

// The owner's profiles, in the order the homepage prints them.
export const profileLinks = [
  { label: "linkedin", name: "LinkedIn", href: "https://www.linkedin.com/in/cristianvega-ai" },
  { label: "x", name: "X", href: "https://x.com/cristianvega" },
  { label: "github", name: "GitHub", href: "https://github.com/cristianvega-ai" },
];

// Each homepage section shows this many rows. The unit test of the selection owns the number.
export const homeSectionSize = 4;

// The homepage sections, in page order.
const homeSectionDefinitions = [
  { section: "products", label: "Products", headingId: "products-label", allHref: "/products/", allLabel: "All products" },
  { section: "writing", label: "Writing", headingId: "writing-label", allHref: "/writing/", allLabel: "All writing" },
];

/**
 * Return the homepage sections that must render, in page order.
 * Each section holds the newest entries, at most four, and the entries come from the visible content.
 * A section with no visible entry is absent. Pass `includeDrafts` for the development server.
 */
export function homeSections(inventory = readContentInventory(), { includeDrafts = false } = {}) {
  return homeSectionDefinitions
    .map((definition) => ({
      ...definition,
      rows: inventory[definition.section].filter((entry) => includeDrafts || !entry.data.draft).slice(0, homeSectionSize),
    }))
    .filter((homeSection) => homeSection.rows.length > 0);
}

export function listBuiltRoutes(buildDirectory = dist, prefix = "/") {
  const routes = [];
  for (const entry of readdirSync(buildDirectory, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== "_astro") {
      routes.push(...listBuiltRoutes(join(buildDirectory, entry.name), `${prefix}${entry.name}/`));
    } else if (entry.name === "index.html") routes.push(prefix);
  }
  return routes.sort();
}

export function sitemapPaths(buildDirectory = dist) {
  return [...readFileSync(join(buildDirectory, "sitemap-0.xml"), "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map(([, location]) => new URL(location).pathname).sort();
}

export function contentRoutes(inventory) {
  return Object.entries(publishedContent(inventory)).flatMap(([section, entries]) =>
    entries.length ? [`/${section}/`, ...entries.map((entry) => entry.href)] : []).sort();
}

export function escapeHtml(inputValue) {
  return String(inputValue).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

export function escapeAttribute(inputValue) {
  return String(inputValue).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

const publicationEntries = {
  writing: [
    { id: "zulu-tied", title: "Zulu tied writing", date: "2026-09-28", draft: false },
    { id: "explicit-draft", title: "Unreleased writing", date: "2026-09-30", draft: true },
    { id: "alpha-tied", title: "Alpha tied writing", date: "2026-09-28", draft: false },
    { id: "default-draft", title: "Default draft writing", date: "2026-10-01" },
    { id: "newer-writing", title: "Newer's \"quoted\" & writing", date: "2026-09-29", draft: false, series: "Publication fixtures" },
  ],
  products: [
    { id: "zulu-product", title: "Zulu's \"quoted\" & product", date: "2026-09-28", draft: false },
    { id: "explicit-draft", title: "Unreleased product", date: "2026-09-30", draft: true },
    { id: "alpha-product", title: "Alpha product", date: "2026-09-28", draft: false, status: "Available", url: "https://example.com/alpha?owner=owner's&state=ready" },
    { id: "default-draft", title: "Default draft product", date: "2026-10-01" },
    { id: "newer-product", title: "Newer product", date: "2026-09-29", draft: false },
  ],
};

// The crowded fixture adds published entries, so each homepage section has more than four rows to cut.
const crowdedEntries = {
  writing: [1, 2, 3].map((number) => ({ id: `extra-writing-${number}`, title: `Extra writing ${number}`, date: `2026-08-0${number}`, draft: false })),
  products: [1, 2, 3].map((number) => ({ id: `extra-product-${number}`, title: `Extra product ${number}`, date: `2026-08-0${number}`, draft: false })),
};

/**
 * Build a project copy in a temporary directory. Preserve repository source, build output, and caches.
 *
 * Map project-relative file paths to [originalText, replacementText] pairs in `edits`.
 * Require each originalText value to occur in its file.
 * Pass the copied project root to `prepare` before the build.
 */
export async function createIsolatedBuild({ prefix = "cristianai-build-", edits = {}, prepare } = {}) {
  const projectRoot = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  const cleanup = () => rm(projectRoot, { recursive: true, force: true });
  try {
    await Promise.all([
      cp(join(root, "src"), join(projectRoot, "src"), { recursive: true }),
      cp(join(root, "public"), join(projectRoot, "public"), { recursive: true }),
      cp(join(root, "tsconfig.json"), join(projectRoot, "tsconfig.json")),
      cp(join(root, "package.json"), join(projectRoot, "package.json")),
      symlink(join(root, "node_modules"), join(projectRoot, "node_modules"), "dir"),
    ]);
    for (const [relativePath, replacements] of Object.entries(edits)) {
      const editedFilePath = join(projectRoot, relativePath);
      let sourceText = await readFile(editedFilePath, "utf8");
      for (const [originalText, replacementText] of replacements) {
        assert.ok(sourceText.includes(originalText), `${relativePath} must contain the original replacement text ${originalText}`);
        sourceText = sourceText.replaceAll(originalText, replacementText);
      }
      await writeFile(editedFilePath, sourceText);
    }
    if (prepare) await prepare(projectRoot);
    const configurationUrl = pathToFileURL(join(root, "astro.config.mjs")).href;
    await writeFile(join(projectRoot, "astro.config.mjs"),
      `import config from ${JSON.stringify(configurationUrl)};\nexport default { ...config, cacheDir: "./.cache/", vite: { ...config.vite, cacheDir: "./.cache/vite/" } };\n`);
    await promisify(execFile)(process.execPath, [join(root, "node_modules", "astro", "bin", "astro.mjs"), "build", "--root", projectRoot], {
      cwd: projectRoot,
      env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" },
      timeout: 60_000,
      maxBuffer: 5_000_000,
    });
    return { root: projectRoot, dist: join(projectRoot, "dist"), cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

// Build fixture content in a temporary project. Keep source content and caches separate.
export async function createContentBuild(fixtureKind) {
  assert.ok(["all-draft", "mixed", "crowded"].includes(fixtureKind), "the publication fixture must be all-draft, mixed, or crowded");
  let inventory;
  const isolatedBuild = await createIsolatedBuild({
    prefix: "cristianai-publication-",
    async prepare(projectRoot) {
      await rm(join(projectRoot, "src", "content"), { recursive: true });
      for (const [collection, baseEntries] of Object.entries(publicationEntries)) {
        const entries = fixtureKind === "crowded" ? [...baseEntries, ...crowdedEntries[collection]] : baseEntries;
        const contentDirectory = join(projectRoot, "src", "content", collection);
        await mkdir(contentDirectory, { recursive: true });
        for (const entry of entries) {
          const { id: entryIdentifier, ...frontmatterData } = entry;
          if (fixtureKind === "all-draft" && "draft" in frontmatterData) frontmatterData.draft = true;
          frontmatterData.description = `Description for ${frontmatterData.title}.`;
          if (collection === "writing") frontmatterData.topic = "Systems";
          const fixtureBody = `## Fixture content\n\nBody for ${entryIdentifier}.\n\n` + (collection === "writing"
            ? "```js\nconst signal = 1;\n```\n\n<div class=\"figure__panel\" role=\"img\" aria-label=\"Fixture signal path\">Signal path</div>\n"
            : "");
          await writeFile(join(contentDirectory, `${entryIdentifier}.md`), `---\n${dump(frontmatterData)}---\n\n${fixtureBody}`);
        }
      }
      inventory = readContentInventory(projectRoot);
    },
  });
  return { ...isolatedBuild, inventory };
}

export async function withContentBuild(fixtureKind, useFixture) {
  const fixture = await createContentBuild(fixtureKind);
  try {
    return await useFixture(fixture);
  } finally {
    await fixture.cleanup();
  }
}

export const blockedBrowserFeatures = [
  "accelerometer", "autoplay", "camera", "display-capture", "encrypted-media",
  "fullscreen", "geolocation", "gyroscope", "magnetometer", "microphone",
  "midi", "payment", "picture-in-picture", "screen-wake-lock", "usb",
  "xr-spatial-tracking",
];
export const permissionsPolicy = blockedBrowserFeatures.map((featureName) => `${featureName}=()`).join(", ");

export function readDistFile(...pathSegments) {
  return readFileSync(join(dist, ...pathSegments), "utf8");
}

/** Count primary heading tags without case sensitivity. */
function countPrimaryHeadings(pageHtml) {
  return (pageHtml.match(/<h1\b[^>]*>/gi) || []).length;
}

export function assertPageBasics(pageHtml, { titleFragment, descriptionFragment } = {}) {
  assert.match(pageHtml, /<html\b[^>]*\blang="en"/i, "document language must be en");
  assert.match(pageHtml, /<link\b[^>]*rel="canonical"/i, "each page must declare a canonical URL");
  assert.match(pageHtml, /<meta\b[^>]*name="description"/i, "each page must declare a metadata description");
  assert.equal(countPrimaryHeadings(pageHtml), 1, "each page must contain exactly one primary heading");
  if (titleFragment) assert.match(pageHtml, new RegExp(titleFragment, "i"));
  if (descriptionFragment) assert.match(pageHtml, new RegExp(descriptionFragment, "i"));
}
