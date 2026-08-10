import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://cristianvega.ai",
  output: "static",
  trailingSlash: "always",
  integrations: [sitemap()]
});
