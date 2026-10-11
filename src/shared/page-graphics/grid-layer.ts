import type { Palette } from "../canvas/palette.ts";

// The site grid as a canvas layer, for a page graphic that draws the grid itself.

/** The pitch of the site grid, in CSS pixels. It matches the homepage and the CSS grid on the other pages. */
const GRID_PITCH = 40;

/**
 * A layer of the site's faint blueprint grid with the same elliptical fade as the CSS grid. Build it on
 * resize and draw it with drawImage. Null when a canvas cannot be made.
 */
export function makeGridLayer(width: number, height: number, ratio: number, palette: Palette): HTMLCanvasElement | null {
  const layer = document.createElement("canvas");
  layer.width = Math.max(1, Math.round(width * ratio));
  layer.height = Math.max(1, Math.round(height * ratio));
  const drawingContext = layer.getContext("2d");
  if (!drawingContext) return null;
  drawingContext.scale(ratio, ratio);
  drawingContext.strokeStyle = palette.grid;
  drawingContext.lineWidth = 1;
  drawingContext.beginPath();
  for (let x = GRID_PITCH / 2; x < width; x += GRID_PITCH) {
    drawingContext.moveTo(Math.round(x) + 0.5, 0);
    drawingContext.lineTo(Math.round(x) + 0.5, height);
  }
  for (let y = GRID_PITCH / 2; y < height; y += GRID_PITCH) {
    drawingContext.moveTo(0, Math.round(y) + 0.5);
    drawingContext.lineTo(width, Math.round(y) + 0.5);
  }
  drawingContext.stroke();
  drawingContext.globalCompositeOperation = "destination-in";
  drawingContext.setTransform(1, 0, 0, 1, 0, 0);
  // A unit radial gradient, stretched to the ellipse of the box.
  drawingContext.translate(layer.width / 2, layer.height / 2);
  drawingContext.scale(layer.width / 2, layer.height / 2);
  const gradient = drawingContext.createRadialGradient(0, 0, 0, 0, 0, 1);
  gradient.addColorStop(0, "rgb(0 0 0)");
  gradient.addColorStop(0.3, "rgb(0 0 0)");
  gradient.addColorStop(0.6, "rgb(0 0 0 / 0.42)");
  gradient.addColorStop(0.94, "rgb(0 0 0 / 0)");
  drawingContext.fillStyle = gradient;
  drawingContext.fillRect(-1, -1, 2, 2);
  return layer;
}
