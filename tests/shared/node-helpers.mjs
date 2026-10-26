import { existsSync, readFileSync, readdirSync } from "node:fs";
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

// The principle groups, in page order.
const principleGroupOrder = ["building", "working-with-models"];

// Read Markdown independently from the application content helpers.
export function readContentInventory(projectRoot = root) {
  const inventory = {};
  // The Lab entries are included only when the project holds a Lab collection. The publication fixtures hold none unless a test asks for one.
  const optionalCollections = ["principles", "lab"].filter((name) => existsSync(join(projectRoot, "src", "content", name)));
  const collections = ["writing", "products", ...optionalCollections];
  for (const [section, collection] of collections.map((name) => [name, name])) {
    const contentDirectory = join(projectRoot, "src", "content", collection);
    inventory[section] = readdirSync(contentDirectory).filter((contentFilename) => contentFilename.endsWith(".md")).map((contentFilename) => {
      const markdownSource = readFileSync(join(contentDirectory, contentFilename), "utf8");
      const frontmatterMatch = markdownSource.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
      assert.ok(frontmatterMatch, `${contentFilename} must have YAML frontmatter`);
      const frontmatterData = load(frontmatterMatch[1]);
      frontmatterData.draft ??= true;
      const id = contentFilename.slice(0, -3);
      if (section === "principles") {
        // A principle has no page of its own. Its address is its place on the principles page.
        frontmatterData.featured ??= false;
        frontmatterData.updated = new Date(frontmatterData.updated);
        return { id, data: frontmatterData, body: markdownSource.slice(frontmatterMatch[0].length), href: `/principles/#${id}` };
      }
      frontmatterData.date = new Date(frontmatterData.date);
      frontmatterData.principles ??= [];
      if (section === "products") frontmatterData.status ??= "Product";
      return { id, data: frontmatterData, body: markdownSource.slice(frontmatterMatch[0].length), href: `/${section}/${id}/` };
    });
  }
  // Every dated collection lists the newest entry first and breaks date ties by id.
  // The principles follow page order: by group, then by order, then by id.
  for (const [section, entries] of Object.entries(inventory)) {
    if (section === "principles") {
      entries.sort((firstEntry, secondEntry) => principleGroupOrder.indexOf(firstEntry.data.group) - principleGroupOrder.indexOf(secondEntry.data.group)
        || firstEntry.data.order - secondEntry.data.order || firstEntry.id.localeCompare(secondEntry.id));
    } else {
      entries.sort((firstEntry, secondEntry) => secondEntry.data.date - firstEntry.data.date || firstEntry.id.localeCompare(secondEntry.id));
    }
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
  { section: "principles", label: "Principles", headingId: "principles-label", allHref: "/principles/", allLabel: "All principles" },
  { section: "products", label: "Products", headingId: "products-label", allHref: "/products/", allLabel: "All products" },
  { section: "lab", label: "Lab", headingId: "lab-label", allHref: "/lab/", allLabel: "All experiments" },
  { section: "writing", label: "Writing", headingId: "writing-label", allHref: "/writing/", allLabel: "All writing" },
];

/**
 * Return the homepage sections that must render, in page order.
 * Each section holds the newest entries, at most four, and the entries come from the visible content.
 * The principles section holds the featured principles in page order, or the first ones when none is featured.
 * A section with no visible entry is absent. Pass `includeDrafts` for the development server.
 */
export function homeSections(inventory = readContentInventory(), { includeDrafts = false } = {}) {
  return homeSectionDefinitions
    .map((definition) => {
      const visibleEntries = (inventory[definition.section] ?? []).filter((entry) => includeDrafts || !entry.data.draft);
      const featuredEntries = visibleEntries.filter((entry) => entry.data.featured);
      const candidates = definition.section === "principles" && featuredEntries.length > 0 ? featuredEntries : visibleEntries;
      return { ...definition, rows: candidates.slice(0, homeSectionSize) };
    })
    .filter((homeSection) => homeSection.rows.length > 0);
}

// A published scene folder holds the model's own files, not an Astro page. Its routes are not site pages.
export const sceneRoutePrefix = "/lab/scenes/";

export function listBuiltRoutes(buildDirectory = dist, prefix = "/") {
  const routes = [];
  for (const entry of readdirSync(buildDirectory, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== "_astro") {
      routes.push(...listBuiltRoutes(join(buildDirectory, entry.name), `${prefix}${entry.name}/`));
    } else if (entry.name === "index.html") routes.push(prefix);
  }
  return routes.sort();
}

/** List the routes of the Astro pages. A scene folder is not an Astro page. */
export function listPageRoutes(buildDirectory = dist) {
  return listBuiltRoutes(buildDirectory).filter((route) => !route.startsWith(sceneRoutePrefix));
}

export function sitemapPaths(buildDirectory = dist) {
  return [...readFileSync(join(buildDirectory, "sitemap-0.xml"), "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map(([, location]) => new URL(location).pathname).sort();
}

// A Lab experiment also builds one live viewer route for each of its results.
// The principles share one page, so a principle adds no route of its own.
export function contentRoutes(inventory) {
  return Object.entries(publishedContent(inventory)).flatMap(([section, entries]) => {
    if (!entries.length) return [];
    if (section === "principles") return ["/principles/"];
    return [`/${section}/`, ...entries.flatMap((entry) => [entry.href, ...(section === "lab" ? entry.data.results.map((result) => `${entry.href}${result.slug}/`) : [])])];
  }).sort();
}

export function escapeHtml(inputValue) {
  return String(inputValue).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

export function escapeAttribute(inputValue) {
  return String(inputValue).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

// The writing fixtures name principles. A published page must list only the published ones.
const publicationEntries = {
  principles: [
    { id: "zulu-principle", title: "Zulu principle", group: "building", order: 1, updated: "2026-09-20", featured: true, draft: false },
    { id: "unreleased-principle", title: "Unreleased principle", group: "building", order: 0, updated: "2026-09-30", featured: true, draft: true },
    { id: "alpha-principle", title: "Alpha's \"quoted\" & principle", group: "building", order: 1, updated: "2026-09-21", draft: false },
    { id: "model-principle", title: "Model principle", group: "working-with-models", order: 1, updated: "2026-09-22", featured: true, draft: false },
    { id: "default-draft", title: "Default draft principle", group: "working-with-models", order: 0, updated: "2026-10-01" },
  ],
  writing: [
    { id: "zulu-tied", title: "Zulu tied writing", date: "2026-09-28", draft: false, principles: ["alpha-principle", "unreleased-principle"] },
    { id: "explicit-draft", title: "Unreleased writing", date: "2026-09-30", draft: true, principles: ["zulu-principle"] },
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
  principles: [1, 2, 3].map((number) => ({ id: `extra-principle-${number}`, title: `Extra principle ${number}`, group: "working-with-models", order: 1 + number, updated: "2026-08-01", featured: true, draft: false })),
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
// Pass `lab` to add the real Lab experiment, with its media linked.
// - `state` is "published" or "draft".
// - `id` renames the experiment, and `resultIndexes` picks its results by position, in order. An index can repeat.
export async function createContentBuild(fixtureKind, { lab } = {}) {
  assert.ok(["all-draft", "mixed", "crowded"].includes(fixtureKind), "the publication fixture must be all-draft, mixed, or crowded");
  assert.ok(lab === undefined || ["published", "draft"].includes(lab.state), "the Lab fixture must be published or draft");
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
          if (collection !== "principles") frontmatterData.description = `Description for ${frontmatterData.title}.`;
          if (collection === "writing") frontmatterData.topic = "Systems";
          // A principle is a statement and a short reason, so its body holds no heading.
          const fixtureBody = collection === "principles" ? `Reason for ${entryIdentifier}.\n` : `## Fixture content\n\nBody for ${entryIdentifier}.\n\n` + (collection === "writing"
            ? "```js\nconst signal = 1;\n```\n\n<div class=\"figure__panel\" role=\"img\" aria-label=\"Fixture signal path\">Signal path</div>\n"
            : "");
          await writeFile(join(contentDirectory, `${entryIdentifier}.md`), `---\n${dump(frontmatterData)}---\n\n${fixtureBody}`);
        }
      }
      if (lab) {
        const labContentDirectory = join(projectRoot, "src", "content", "lab");
        await cp(join(root, "src", "content", "lab"), labContentDirectory, { recursive: true });
        const originalPath = join(labContentDirectory, `${labFixture.experiment}.md`);
        const experimentSource = await readFile(originalPath, "utf8");
        const frontmatterMatch = experimentSource.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
        assert.ok(frontmatterMatch, "the repository Lab experiment must have YAML frontmatter");
        const frontmatterData = load(frontmatterMatch[1]);
        frontmatterData.draft = lab.state === "draft";
        // The fixture holds its own principles, so the experiment names one published and one draft principle.
        frontmatterData.principles = ["model-principle", "unreleased-principle"];
        if (lab.resultIndexes) {
          frontmatterData.results = lab.resultIndexes.map((resultIndex) => {
            const result = frontmatterData.results[resultIndex];
            assert.ok(result, `the repository Lab experiment must hold a result at position ${resultIndex}`);
            return result;
          });
        }
        await rm(originalPath);
        await writeFile(join(labContentDirectory, `${lab.id ?? labFixture.experiment}.md`), `---\n${dump(frontmatterData)}---\n\n${experimentSource.slice(frontmatterMatch[0].length)}`);
        // The media integration reads assets/lab from the project root.
        await symlink(join(root, "assets"), join(projectRoot, "assets"), "dir");
      }
      inventory = readContentInventory(projectRoot);
    },
  });
  return { ...isolatedBuild, inventory };
}

// The first Lab experiment holds real media, so the Lab fixtures build it from the repository.
export const labFixture = {
  experiment: "floating-castles",
  resultCount: 8,
};

/** List every file below a folder as a sorted list of paths relative to it. */
export function listFiles(folder, prefix = "") {
  const filePaths = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (entry.isDirectory()) filePaths.push(...listFiles(join(folder, entry.name), `${prefix}${entry.name}/`));
    else filePaths.push(`${prefix}${entry.name}`);
  }
  return filePaths.sort();
}

export async function withContentBuild(fixtureKind, useFixture, options) {
  const fixture = await createContentBuild(fixtureKind, options);
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
