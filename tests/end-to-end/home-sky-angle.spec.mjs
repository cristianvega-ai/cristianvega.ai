import { expect, test } from "@playwright/test";

import { useReducedMotion } from "../shared/browser-fixtures.mjs";

// The angle is the parallactic angle of Vega for a fixed latitude of 40 degrees north.
// The time zone sets the longitude, so every case runs in UTC and sets the clock before the page loads.
// These cases follow physical rules and not the formula: zero at transit, opposite signs on each side.
test.use({ timezoneId: "UTC" });

const vegaTransit = "2026-10-24T16:24:36Z";
// Three hours before and after the transit, Vega stands east and west of the meridian.
const skyAngleCases = [
  { moment: "2026-10-24T13:24:36Z", description: "three hours before the transit", expectedAngle: -73.34, tolerance: 0.5 },
  { moment: vegaTransit, description: "at the transit", expectedAngle: 0, tolerance: 1 },
  { moment: "2026-10-24T19:24:36Z", description: "three hours after the transit", expectedAngle: 73.33, tolerance: 0.5 },
];

const readSkyAngle = (page) => page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sky-angle")));

for (const { moment, description, expectedAngle, tolerance } of skyAngleCases) {
  test(`The sky angle is ${expectedAngle} degrees ${description}`, async ({ page }) => {
    await page.clock.setFixedTime(new Date(moment));
    await page.goto("/");
    const skyAngle = await readSkyAngle(page);
    expect(Number.isFinite(skyAngle), `Sky angle at ${moment}: --sky-angle must hold a number of degrees`).toBe(true);
    expect(Math.abs(skyAngle - expectedAngle), `Sky angle at ${moment} (${description}): ${skyAngle} degrees must lie within ${tolerance} degrees of ${expectedAngle}`).toBeLessThanOrEqual(tolerance);
  });
}

test("The sky angle has opposite signs on each side of the transit", async ({ page }) => {
  const angles = [];
  for (const { moment } of skyAngleCases) {
    await page.clock.setFixedTime(new Date(moment));
    await page.goto("/");
    angles.push(await readSkyAngle(page));
  }
  const [beforeTransit, atTransit, afterTransit] = angles;
  expect(beforeTransit, "Sky angle: before the transit it must be negative").toBeLessThan(-1);
  expect(afterTransit, "Sky angle: after the transit it must be positive").toBeGreaterThan(1);
  expect(Math.abs(atTransit), "Sky angle: at the transit it must be smaller than at the sides").toBeLessThan(Math.min(Math.abs(beforeTransit), afterTransit));
});

test("The sky angle is set before the body renders and turns the mark", async ({ page }) => {
  await useReducedMotion(page);
  await page.clock.setFixedTime(new Date(skyAngleCases[0].moment));
  // A deferred script would set the angle after the body exists, so the first read would be empty.
  await page.addInitScript(() => {
    new MutationObserver(() => {
      if (document.body && window.__skyAngleAtBody === undefined) {
        window.__skyAngleAtBody = getComputedStyle(document.documentElement).getPropertyValue("--sky-angle");
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto("/");
  const angleAtBody = await page.evaluate(() => window.__skyAngleAtBody);
  expect(angleAtBody, "Sky angle: the property must exist when the body first appears").toMatch(/^-73\.34deg$/);
  const markTurn = await page.locator("header.identity .mark__sky").evaluate((element) => {
    const [a, b] = getComputedStyle(element).transform.match(/-?[\d.]+(?:e-?\d+)?/g).map(Number);
    return (Math.atan2(b, a) * 180) / Math.PI;
  });
  expect(Math.abs(markTurn - skyAngleCases[0].expectedAngle), `Sky angle: the mark must turn by ${markTurn} degrees, the angle in the custom property`).toBeLessThanOrEqual(0.5);
});
