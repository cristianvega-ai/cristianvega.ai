import { readFileSync, readdirSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import yaml from "js-yaml";

// Fixtures more than one Node test file needs: the repository and build paths,
// the two file readers, and the page contract every rendered document must meet.
// A helper that only one suite uses stays in that suite.

// fileURLToPath, not URL.pathname: the latter stays percent-encoded, so a
// checkout under a path with spaces or non-ASCII characters would ENOENT.
export const root = fileURLToPath(new URL("..", import.meta.url));
export const dist = join(root, "dist");

// Read the size and aspect ratio of a figure.
export const figureBox = (points) => {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  return { width, height, aspect: width / height };
};

// Keep the reference star widths in CSS pixels.
export const starWidthsCssPx = [66, 0, 0, 0, 42, 42];

// Read Markdown independently from the application content helpers.
export function readContentInventory(projectRoot = root) {
  const inventory = {};
  for (const [section, collection] of [["writing", "writing"], ["products", "products"]]) {
    const directory = join(projectRoot, "src", "content", collection);
    inventory[section] = readdirSync(directory).filter((file) => file.endsWith(".md")).map((file) => {
      const markdown = readFileSync(join(directory, file), "utf8");
      const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
      assert.ok(frontmatter, `${file} must have YAML frontmatter`);
      const data = yaml.load(frontmatter[1]);
      data.draft ??= true;
      if (section === "writing") data.date = new Date(data.date);
      else {
        data.order ??= 0;
        data.status ??= "Product";
      }
      return { id: file.slice(0, -3), data, body: markdown.slice(frontmatter[0].length), href: `/${section}/${file.slice(0, -3)}/` };
    });
  }
  inventory.writing.sort((a, b) => b.data.date - a.data.date || a.id.localeCompare(b.id));
  inventory.products.sort((a, b) => a.data.order - b.data.order || a.data.title.localeCompare(b.data.title));
  return inventory;
}

export function publishedContent(inventory = readContentInventory()) {
  return Object.fromEntries(Object.entries(inventory).map(([section, entries]) => [section, entries.filter((entry) => !entry.data.draft)]));
}

export const latestWork = [
  { section: "writing", href: "/writing/", label: "Read my latest writing", soon: "Latest writing · coming soon" },
  { section: "products", href: "/products/", label: "See my latest products", soon: "Latest products · coming soon" },
];

// The header links in site order. A section joins them when it holds a published entry.
export function headerLinks(inventory = readContentInventory()) {
  const published = publishedContent(inventory);
  return [
    { label: "about", href: "/about/" },
    ...latestWork.filter((item) => published[item.section].length > 0).map((item) => ({ label: item.section, href: item.href })),
    { label: "linkedin", href: "https://www.linkedin.com/in/cristianvega-ai" },
    { label: "x", href: "https://x.com/cristianvega" },
    { label: "github", href: "https://github.com/cristianvega-ai" },
  ];
}

export function listBuiltRoutes(directory = dist, prefix = "/") {
  const routes = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== "_astro") {
      routes.push(...listBuiltRoutes(join(directory, entry.name), `${prefix}${entry.name}/`));
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

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

export function escapeAttribute(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
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
    { id: "zulu-product", title: "Zulu's \"quoted\" & product", draft: false, order: 4 },
    { id: "explicit-draft", title: "Unreleased product", draft: true, order: -2 },
    { id: "alpha-product", title: "Alpha product", draft: false, order: 4, status: "Available", url: "https://example.com/alpha?owner=owner's&state=ready" },
    { id: "default-draft", title: "Default draft product", order: -3 },
    { id: "default-order", title: "Default order product", draft: false },
  ],
};

/**
 * Build a copy of the project in a temporary directory. The source, the build
 * output, and the caches of the repository stay unchanged.
 *
 * `edits` maps a file path below the project root to a list of [before, after]
 * replacements. Each `before` must occur in the file, so a stale edit fails
 * instead of building the unchanged source. `prepare` receives the copy's root
 * and can change it further before the build.
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
    for (const [path, replacements] of Object.entries(edits)) {
      const file = join(projectRoot, path);
      let source = await readFile(file, "utf8");
      for (const [before, after] of replacements) {
        assert.ok(source.includes(before), `${path} must hold ${before}`);
        source = source.replaceAll(before, after);
      }
      await writeFile(file, source);
    }
    if (prepare) await prepare(projectRoot);
    const configUrl = pathToFileURL(join(root, "astro.config.mjs")).href;
    await writeFile(join(projectRoot, "astro.config.mjs"),
      `import config from ${JSON.stringify(configUrl)};\nexport default { ...config, cacheDir: "./.cache/", vite: { ...config.vite, cacheDir: "./.cache/vite/" } };\n`);
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
export async function createContentBuild(kind) {
  assert.ok(["all-draft", "mixed"].includes(kind), "select an approved publication fixture");
  let inventory;
  const build = await createIsolatedBuild({
    prefix: "cristianai-publication-",
    async prepare(projectRoot) {
      await rm(join(projectRoot, "src", "content"), { recursive: true });
      for (const [collection, entries] of Object.entries(publicationEntries)) {
        const directory = join(projectRoot, "src", "content", collection);
        await mkdir(directory, { recursive: true });
        for (const entry of entries) {
          const { id, ...data } = entry;
          if (kind === "all-draft" && "draft" in data) data.draft = true;
          data.description = `Description for ${data.title}.`;
          if (collection === "writing") data.topic = "Systems";
          const body = `## Fixture content\n\nBody for ${id}.\n\n` + (collection === "writing"
            ? "```js\nconst signal = 1;\n```\n\n<div class=\"figure__panel\" role=\"img\" aria-label=\"Fixture signal path\">Signal path</div>\n"
            : "");
          await writeFile(join(directory, `${id}.md`), `---\n${yaml.dump(data)}---\n\n${body}`);
        }
      }
      inventory = readContentInventory(projectRoot);
    },
  });
  return { ...build, inventory };
}

export async function withContentBuild(kind, use) {
  const fixture = await createContentBuild(kind);
  try {
    return await use(fixture);
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
export const permissionsPolicy = blockedBrowserFeatures.map((name) => `${name}=()`).join(", ");

export function readDistFile(...segments) {
  return readFileSync(join(dist, ...segments), "utf8");
}

export function readSourceFile(...segments) {
  return readFileSync(join(root, "src", ...segments), "utf8");
}

/** Count <h1>…</h1> occurrences (case-insensitive tag). */
function countH1(html) {
  return (html.match(/<h1\b[^>]*>/gi) || []).length;
}

export function assertPageBasics(html, { titleFragment, descriptionFragment } = {}) {
  assert.match(html, /<html\b[^>]*\blang="en"/i, "document language must be en");
  assert.match(html, /<link\b[^>]*rel="canonical"/i, "canonical URL required");
  assert.match(html, /<meta\b[^>]*name="description"/i, "meta description required");
  assert.equal(countH1(html), 1, "each page must have exactly one H1");
  if (titleFragment) assert.match(html, new RegExp(titleFragment, "i"));
  if (descriptionFragment) assert.match(html, new RegExp(descriptionFragment, "i"));
}
