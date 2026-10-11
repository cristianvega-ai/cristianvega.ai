import { expect, test } from "@playwright/test";

import { settle, useReducedMotion, VIEWPORTS as viewports } from "../shared/browser-fixtures.mjs";

const sceneTargets = [
  { name: "globe", route: "/", selector: "[data-lyra-globe]", heading: "Cristian Vega" },
  { name: "page", route: "/about/", selector: "[data-graphic='about']", heading: "Cristian Vega" },
];

/**
 * Read the completed canvas at the emulated device pixel ratio.
 * Compare foreground paint fractions in a 4 by 4 bitmap grid.
 */
async function readCanvasPaint(browser, baseAddress, sceneTarget, deviceScaleFactor) {
  const browserContext = await browser.newContext({ viewport: viewports.desktop, deviceScaleFactor });
  const page = await browserContext.newPage();
  await useReducedMotion(page);
  await page.goto(new URL(sceneTarget.route, baseAddress).href);
  await expect(page.locator(sceneTarget.selector)).toHaveAttribute("data-motion-state", "still");
  await settle(page);
  const canvasPaint = await page.locator(`${sceneTarget.selector} canvas`).evaluate((canvas) => {
    const { width, height } = canvas;
    const { data: pixelData } = canvas.getContext("2d").getImageData(0, 0, width, height);
    const cellPaintCounts = new Array(16).fill(0);
    let foregroundPixelCount = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (pixelData[(y * width + x) * 4 + 3] <= 140) continue;
        cellPaintCounts[Math.floor((y * 4) / height) * 4 + Math.floor((x * 4) / width)] += 1;
        foregroundPixelCount += 1;
      }
    }
    const canvasRectangle = canvas.getBoundingClientRect();
    return { ratio: devicePixelRatio, bitmapSize: [width, height], layoutSize: [canvasRectangle.width, canvasRectangle.height], cells: cellPaintCounts, foregroundPixelCount };
  });
  await browserContext.close();
  expect(canvasPaint.foregroundPixelCount, `${sceneTarget.name}: the canvas must contain foreground paint before pixel ratio comparison`).toBeGreaterThan(0);
  return { ...canvasPaint, cells: canvasPaint.cells.map((cellPixelCount) => cellPixelCount / canvasPaint.foregroundPixelCount) };
}

for (const [sceneTarget, deviceScaleFactor] of [[sceneTargets[1], 2], [sceneTargets[0], 1.5]]) {
  test(`${sceneTarget.name} draws the complete canvas at a device pixel ratio of ${deviceScaleFactor}`, async ({ browser, baseURL: baseAddress }) => {
    const referencePaint = await readCanvasPaint(browser, baseAddress, sceneTarget, 1);
    const scaledPaint = await readCanvasPaint(browser, baseAddress, sceneTarget, deviceScaleFactor);
    expect(scaledPaint.ratio).toBe(deviceScaleFactor);
    // Each tested ratio stays below its scene cap.
    // The bitmap dimensions must equal the layout dimensions multiplied by the ratio.
    expect(Math.abs(scaledPaint.bitmapSize[0] - scaledPaint.layoutSize[0] * deviceScaleFactor), `Bitmap ${scaledPaint.bitmapSize} must match layout ${scaledPaint.layoutSize} at pixel ratio ${deviceScaleFactor}`).toBeLessThanOrEqual(1);
    expect(Math.abs(scaledPaint.bitmapSize[1] - scaledPaint.layoutSize[1] * deviceScaleFactor), `Bitmap ${scaledPaint.bitmapSize} must match layout ${scaledPaint.layoutSize} at pixel ratio ${deviceScaleFactor}`).toBeLessThanOrEqual(1);
    // Complete canvases keep the paint distribution difference below 0.15 on macOS.
    // Cropped canvases increase that difference to 1.5 for the globe and 2 for About.
    const paintDistributionDifference = scaledPaint.cells.reduce((totalDifference, paintShare, cellIndex) => totalDifference + Math.abs(paintShare - referencePaint.cells[cellIndex]), 0);
    expect(paintDistributionDifference, "The higher pixel ratio must preserve the complete canvas paint distribution").toBeLessThan(0.5);
  });
}
