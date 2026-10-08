import { expect, test } from "@playwright/test";

import { blockedBrowserFeatures } from "../helpers.mjs";
import { useReducedMotion } from "./fixtures.mjs";

for (const path of ["/", "/missing-security-check/"]) {
  test(`${path} blocks injected style elements and attributes`, async ({ page }) => {
    await useReducedMotion(page);
    await page.addInitScript(() => {
      window.__styleViolations = [];
      document.addEventListener("securitypolicyviolation", (event) => {
        window.__styleViolations.push(event.effectiveDirective);
      });
    });
    await page.goto(path);
    await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.dataset.securityProbe = "";
      probe.textContent = "Style policy check";
      document.body.append(probe);
      probe.setAttribute("style", "opacity: 0");
      const style = document.createElement("style");
      style.textContent = "[data-security-probe] { visibility: hidden; }";
      document.head.append(style);
    });
    await expect.poll(() => page.evaluate(() => window.__styleViolations)).toEqual(
      expect.arrayContaining(["style-src-attr", "style-src-elem"]),
    );
    await expect(page.locator("[data-security-probe]")).toHaveCSS("opacity", "1");
    await expect(page.locator("[data-security-probe]")).toBeVisible();
  });

  test(`${path} denies unused browser features`, async ({ page }) => {
    await page.goto(path);
    const permissions = await page.evaluate((names) => {
      const policy = document.featurePolicy;
      return names.map((name) => ({
        name,
        known: policy.features().includes(name),
        allowed: policy.allowsFeature(name),
      }));
    }, blockedBrowserFeatures);
    expect(permissions).toEqual(blockedBrowserFeatures.map((name) => ({
      name, known: true, allowed: false,
    })));
  });
}
