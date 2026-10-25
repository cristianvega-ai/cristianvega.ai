import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import labMedia from "./src/integrations/lab-media.ts";

export default defineConfig({
  site: "https://cristianvega.ai",
  output: "static",
  trailingSlash: "always",
  // lab-media serves the Lab clips and scenes in development and copies the published ones into the build.
  integrations: [sitemap(), labMedia()],
  // Render code without inline styles, as the security policy requires.
  markdown: { syntaxHighlight: false },
  // The security policy permits stylesheets from this site only.
  build: { inlineStylesheets: "never" },
  // Keep built scripts in files so the security policy can load them.
  vite: { build: { assetsInlineLimit: 0 } },
});
