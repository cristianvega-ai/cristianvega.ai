import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

/** Map post slug → ISO date string for sitemap lastmod (updatedDate ?? date). */
function loadPostLastmods() {
  const dir = join(process.cwd(), "src/content/posts");
  const map = new Map();

  for (const file of readdirSync(dir)) {
    if (!/\.(md|mdx)$/.test(file)) continue;
    const slug = file.replace(/\.(md|mdx)$/, "");
    const raw = readFileSync(join(dir, file), "utf8");
    const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm) continue;

    const block = fm[1];
    if (/^draft:\s*true\s*$/m.test(block)) continue;

    const updated = block.match(/^updatedDate:\s*['"]?(\d{4}-\d{2}-\d{2})['"]?\s*$/m)?.[1];
    const date = block.match(/^date:\s*['"]?(\d{4}-\d{2}-\d{2})['"]?\s*$/m)?.[1];
    if (!date) continue;

    map.set(slug, updated ?? date);
  }

  return map;
}

const postLastmods = loadPostLastmods();

export default defineConfig({
  site: "https://cristianvega.ai",
  output: "static",
  trailingSlash: "always",
  integrations: [
    sitemap({
      serialize(item) {
        const match = item.url.match(/\/posts\/([^/]+)\/?$/);
        if (match) {
          const lastmod = postLastmods.get(match[1]);
          if (lastmod) item.lastmod = new Date(`${lastmod}T00:00:00.000Z`).toISOString();
        }
        return item;
      },
    }),
  ],
});
