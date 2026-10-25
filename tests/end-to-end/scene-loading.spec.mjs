import { expect } from "@playwright/test";
import { join } from "node:path";
import { labTest as test } from "../shared/browser-fixtures.mjs";
import { listFiles, root as repositoryRoot } from "../shared/node-helpers.mjs";

// A scene runs under its own policy in an opaque origin. Its own scripts, modules, styles, and fonts must load from its folder.
// The real scenes are 3D apps that load the processor for minutes in a browser without a graphics card.
// So each test replaces the entry page of a scene with a probe page and keeps the real response headers and the real files.
// The probe asks for every file of the scene folder the way a scene does.

// Chromium treats an opaque origin as public and refuses its requests to the loopback address that the local runtime uses.
// This switch turns that local-network check off, so the test reaches the policy of the scene. A public host has no such check.
test.use({ launchOptions: { args: ["--disable-features=LocalNetworkAccessChecks"] } });

const probePage = (files) => `<!doctype html><title>Scene probe</title>
<script>
window.__probe = (async () => {
  const files = ${JSON.stringify(files)};
  const violations = [];
  document.addEventListener("securitypolicyviolation", (event) => violations.push(event.violatedDirective + " " + event.blockedURI));
  const outcomes = {};
  const settle = async (name, load) => {
    try {
      outcomes[name] = await load();
    } catch (error) {
      outcomes[name] = "error " + error.name;
    }
  };
  for (const file of files) {
    // Cloudflare answers the address of index.html with a redirect to the folder. A scene asks for the folder.
    await settle("fetch " + file, async () => (await fetch(file === "index.html" ? "./" : "./" + file)).status);
    if (file.endsWith(".css")) {
      await settle("style " + file, () => new Promise((resolve, reject) => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "./" + file;
        link.onload = () => resolve("loaded");
        link.onerror = () => reject(new Error("style"));
        document.head.append(link);
      }));
    }
    if (file.endsWith(".woff2")) await settle("font " + file, async () => { await new FontFace("probe", "url(./" + file + ")").load(); return "loaded"; });
    if (file.includes("/vendor/") && file.endsWith(".js")) await settle("module " + file, async () => { await import("./" + file); return "loaded"; });
  }
  return { origin: window.origin, outcomes, violations };
})();
</script>`;

const experimentFolder = (lab) => join(repositoryRoot, "assets", "lab", lab.experiment.id, "scenes");

test("Every scene file loads from an opaque origin under the scene policy", async ({ page, lab }) => {
  test.setTimeout(60_000);
  let probedFileCount = 0;
  for (const result of lab.results) {
    const files = listFiles(join(experimentFolder(lab), result.slug));
    expect(files, `Scene ${result.slug}: the scene folder must hold its entry page`).toContain("index.html");
    const folderAddress = `${lab.origin}/lab/scenes/${lab.experiment.id}/${result.slug}/`;
    await page.route(folderAddress, async (route) => {
      const response = await route.fetch();
      const body = probePage(files);
      await route.fulfill({ response, body, headers: { ...response.headers(), "content-length": String(Buffer.byteLength(body)) } });
    });
    await page.goto(folderAddress);
    const probe = await page.evaluate(() => window.__probe);
    expect(probe.origin, `Scene ${result.slug}: the probe must run in an opaque origin`).toBe("null");
    expect(probe.violations, `Scene ${result.slug}: the policy must refuse nothing`).toEqual([]);
    for (const [name, outcome] of Object.entries(probe.outcomes)) {
      expect(String(outcome), `Scene ${result.slug}: ${name} must load`).toMatch(/^(200|loaded)$/);
    }
    probedFileCount += files.length;
  }
  expect(probedFileCount, "The probe must cover the scene files").toBeGreaterThan(lab.results.length);
});
