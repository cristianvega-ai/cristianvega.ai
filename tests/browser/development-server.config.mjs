import config from "../../astro.config.mjs";

// The draft preview server for the browser tests. It uses the site
// configuration with one change: the server sends no reload to the browser.
//
// On its first start, the dev server writes .astro/data-store.json about
// 500 ms after it reports ready. Astro then tells every open page to reload.
// A test page that is open at that time loses its document, and the test
// fails with "Execution context was destroyed". The tests do not edit
// files, so they need no reload.
export default { ...config, vite: { ...config.vite, server: { ...config.vite?.server, hmr: false } } };
