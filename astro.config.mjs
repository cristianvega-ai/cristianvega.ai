import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://cristianvega.ai",
  output: "static",
  trailingSlash: "always",
  integrations: [
    sitemap({
      // Projects and writing are not linked or indexed while they are still in
      // progress. They stay out of the sitemap until they go live again.
      filter: (page) => !/\/(projects|writing|posts)\//.test(new URL(page).pathname),
    }),
  ],
});
