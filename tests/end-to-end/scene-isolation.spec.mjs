import { expect } from "@playwright/test";
import { contentSecurityPolicyViolations, labTest as test, recordContentSecurityPolicyViolations, stubSceneBodies } from "../shared/browser-fixtures.mjs";

// A scene is a model-written page. It runs sandboxed in an opaque origin, so it cannot read this site's storage, cookies, or page.
// These tests use the real headers of the local Cloudflare runtime. The origin of a document comes from those headers,
// so the tests replace the scene body with a small stub. A real scene is a 3D app that starves the page of processor time.

const sceneResult = (lab) => lab.results[0];

test.beforeEach(async ({ page }) => {
  await stubSceneBodies(page);
});
const sceneFrame = (page) => page.frames().find((frame) => new URL(frame.url()).pathname.startsWith("/lab/scenes/"));

/** Report what a scene sees when it reaches for something that is not its own. Read the error name, not the value. */
const probeScene = (frame) => frame.evaluate(() => {
  const attempt = (read) => {
    try {
      return { reached: true, value: String(read()) };
    } catch (error) {
      return { reached: false, error: error.name };
    }
  };
  return {
    // window.origin is the origin of the document. location.origin is the origin of its address, which a sandbox does not change.
    origin: window.origin,
    ownLocalStorage: attempt(() => localStorage.length),
    ownCookies: attempt(() => document.cookie),
    parentStorage: attempt(() => window.parent.localStorage.getItem("lab-isolation-probe")),
    parentDocument: attempt(() => window.parent.document.title),
    parentCookies: attempt(() => window.parent.document.cookie),
  };
});

test("The scene frame has an opaque origin and cannot read the storage, cookies, or document of the page", async ({ page, lab }) => {
  const result = sceneResult(lab);
  await page.goto(`${lab.origin}${lab.experiment.href}${result.slug}/`);
  await page.evaluate(() => {
    localStorage.setItem("lab-isolation-probe", "parent secret");
    document.cookie = "lab-isolation-probe=parent secret; path=/";
  });
  await expect.poll(() => sceneFrame(page)?.url(), { message: "The scene frame must load its own folder" }).toBe(`${lab.origin}/lab/scenes/${lab.experiment.id}/${result.slug}/`);
  const probe = await probeScene(sceneFrame(page));
  expect(probe.origin, "Scene frame: the origin must be opaque").toBe("null");
  expect(probe.ownLocalStorage, "Scene frame: an opaque origin has no storage of its own").toEqual({ reached: false, error: "SecurityError" });
  expect(probe.ownCookies, "Scene frame: an opaque origin has no cookies").toEqual({ reached: false, error: "SecurityError" });
  expect(probe.parentStorage, "Scene frame: the storage of the page must stay unreadable").toEqual({ reached: false, error: "SecurityError" });
  expect(probe.parentDocument, "Scene frame: the document of the page must stay unreadable").toEqual({ reached: false, error: "SecurityError" });
  expect(probe.parentCookies, "Scene frame: the cookies of the page must stay unreadable").toEqual({ reached: false, error: "SecurityError" });
  // The page keeps its own values.
  expect(await page.evaluate(() => localStorage.getItem("lab-isolation-probe"))).toBe("parent secret");
});

test("A scene that a visitor opens directly still runs in an opaque origin", async ({ page, lab }) => {
  await page.goto(`${lab.origin}/lab/scenes/${lab.experiment.id}/${sceneResult(lab).slug}/`);
  const probe = await probeScene(page.mainFrame());
  expect(probe.origin, "Direct scene: the sandbox header must give an opaque origin").toBe("null");
  expect(probe.ownLocalStorage).toEqual({ reached: false, error: "SecurityError" });
  expect(probe.ownCookies).toEqual({ reached: false, error: "SecurityError" });
});

test("The page that holds the scene keeps the site policy and blocks inline scripts", async ({ page, lab }) => {
  await recordContentSecurityPolicyViolations(page);
  const response = await page.goto(`${lab.origin}${lab.experiment.href}${sceneResult(lab).slug}/`);
  const policy = response.headers()["content-security-policy"];
  expect(policy, "Scene page: the page must keep the site policy, not the sandbox policy").toContain("script-src 'self' https://static.cloudflareinsights.com/beacon.min.js");
  expect(policy).toContain("frame-ancestors 'none'");
  expect(policy).not.toMatch(/sandbox|unsafe-inline/);
  expect(response.headers()["x-frame-options"]).toBe("DENY");
  await page.evaluate(() => {
    const inlineScript = document.createElement("script");
    inlineScript.textContent = "window.__inlineScriptRan = true;";
    document.head.append(inlineScript);
  });
  await expect.poll(() => contentSecurityPolicyViolations(page), { message: "Scene page: the page must report the blocked inline script" }).toEqual(expect.arrayContaining([expect.stringMatching(/^script-src/)]));
  expect(await page.evaluate(() => window.__inlineScriptRan), "Scene page: the inline script must not run").toBeUndefined();
});

test("Only this site can frame a scene, and the other pages of the site cannot be framed", async ({ page, lab }) => {
  const scenePath = `/lab/scenes/${lab.experiment.id}/${sceneResult(lab).slug}/`;
  // Another origin embeds the scene. The policy of the scene must refuse it.
  await page.route("http://other-origin.test/", (route) => route.fulfill({ contentType: "text/html", body: `<!doctype html><iframe src="${lab.origin}${scenePath}"></iframe>` }));
  await page.goto("http://other-origin.test/");
  await expect.poll(() => page.frames().filter((frame) => frame !== page.mainFrame()).map((frame) => frame.url().startsWith("chrome-error:")), { message: "Framing: another origin must not display the scene" }).toEqual([true]);

  // This site frames its own scene and its own pages. The scene loads and a page does not.
  await page.goto(lab.origin + "/");
  const frameResults = await page.evaluate(async ([allowedPath, refusedPath]) => {
    const load = (path) => new Promise((resolve) => {
      const frame = document.createElement("iframe");
      frame.addEventListener("load", () => resolve(frame));
      frame.src = path;
      document.body.append(frame);
    });
    const allowed = await load(allowedPath);
    const refused = await load(refusedPath);
    return { allowed: allowed.contentDocument === null, refused: refused.contentDocument === null };
  }, [scenePath, "/lab/"]);
  // A framed scene has an opaque origin, so the page cannot read its document. A refused page shows an error document.
  expect(frameResults.allowed, "Framing: this site must display a scene").toBe(true);
  const urls = page.frames().filter((frame) => frame !== page.mainFrame()).map((frame) => new URL(frame.url()).pathname);
  expect(urls, "Framing: the scene frame must keep its address").toContain(scenePath);
  expect(page.frames().some((frame) => frame.url().startsWith("chrome-error:")), "Framing: a page of the site must refuse to be framed").toBe(true);
});
