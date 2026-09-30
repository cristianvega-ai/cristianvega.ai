import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://cristianvega.ai",
  output: "static",
  trailingSlash: "always",
  integrations: [sitemap()],
  // Render code without inline styles, as the security policy requires.
  markdown: { syntaxHighlight: false },
  // The security policy permits stylesheets from this site only.
  build: { inlineStylesheets: "never" },
  // Keep built scripts in files so the security policy can load them.
  vite: { build: { assetsInlineLimit: 0 } },
});
