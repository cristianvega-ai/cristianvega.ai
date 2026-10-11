import siteConfiguration from "../../astro.config.mjs";

// Use the site configuration to serve drafts without browser reloads.
// Astro writes .astro/data-store.json about 500 ms after the development server reports ready.
// The resulting reload can destroy a test page execution context.
// Disable reloads because browser tests do not edit source files.
export default { ...siteConfiguration, vite: { ...siteConfiguration.vite, server: { ...siteConfiguration.vite?.server, hmr: false } } };
