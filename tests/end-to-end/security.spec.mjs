import { expect, test } from "@playwright/test";

import { blockedBrowserFeatures } from "../shared/node-helpers.mjs";
import { useReducedMotion } from "../shared/browser-fixtures.mjs";

for (const pagePath of ["/", "/missing-security-check/"]) {
  test(`${pagePath} rejects injected style elements and style attributes`, async ({ page }) => {
    await useReducedMotion(page);
    await page.addInitScript(() => {
      window.__styleViolations = [];
      document.addEventListener("securitypolicyviolation", (event) => {
        window.__styleViolations.push(event.effectiveDirective);
      });
    });
    await page.goto(pagePath);
    await page.evaluate(() => {
      const styleProbe = document.createElement("div");
      styleProbe.dataset.securityProbe = "";
      styleProbe.textContent = "Style policy check";
      document.body.append(styleProbe);
      styleProbe.setAttribute("style", "opacity: 0");
      const injectedStyle = document.createElement("style");
      injectedStyle.textContent = "[data-security-probe] { visibility: hidden; }";
      document.head.append(injectedStyle);
    });
    await expect.poll(() => page.evaluate(() => window.__styleViolations)).toEqual(
      expect.arrayContaining(["style-src-attr", "style-src-elem"]),
    );
    await expect(page.locator("[data-security-probe]")).toHaveCSS("opacity", "1");
    await expect(page.locator("[data-security-probe]")).toBeVisible();
  });

  test(`${pagePath} blocks unused browser features through the permissions policy`, async ({ page }) => {
    await page.goto(pagePath);
    const featurePermissions = await page.evaluate((featureNames) => {
      const featurePolicy = document.featurePolicy;
      return featureNames.map((featureName) => ({
        name: featureName,
        known: featurePolicy.features().includes(featureName),
        allowed: featurePolicy.allowsFeature(featureName),
      }));
    }, blockedBrowserFeatures);
    expect(featurePermissions).toEqual(blockedBrowserFeatures.map((featureName) => ({
      name: featureName, known: true, allowed: false,
    })));
  });
}
