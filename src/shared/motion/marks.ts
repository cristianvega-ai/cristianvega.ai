import { clamp, easeOutCubic, riseAndFall, smooth } from "./easing.ts";
import { FULL_TURN_RADIANS } from "./geometry.ts";
import type { Palette } from "./palette.ts";

// Drawing marks for the homepage globe and the page graphics. The build-time SVG of the globe
// reads the same sizes. Sizes are in the units of the drawing: CSS pixels on a page graphic,
// grid units on the globe. Every mark draws with no allocation, so a frame is cheap.
// Each mark leaves globalAlpha at 1, and the bloom restores the blend mode.

/** The halo reach of a hot neuron and of Vega. */
export const NODE_HALO = 8;
export const VEGA_HALO = 18;
/** The extra ring round Vega: its radius and its alpha. */
export const VEGA_RING_RADIUS = 10;
export const VEGA_RING_ALPHA = 0.6;
/** The alpha of a hot edge. A cold edge draws with its own alpha. */
export const HOT_EDGE_ALPHA = 0.7;

/** A neuron: a soft halo when hot (`halo` 0..1 sets its strength), a bright core, and an extra ring on Vega. `grow` 0..1 is the appear share. */
export function drawNode(
  drawingContext: CanvasRenderingContext2D,
  palette: Palette,
  glow: HTMLCanvasElement,
  x: number,
  y: number,
  radius: number,
  grow: number,
  hot: boolean,
  alpha: number,
  vega: boolean,
  halo = 1,
): void {
  if (grow <= 0) return;
  const growth = easeOutCubic(grow);
  if (hot && halo > 0) {
    const reach = (vega ? VEGA_HALO : NODE_HALO) * growth;
    drawingContext.globalAlpha = growth * halo;
    drawingContext.drawImage(glow, x - reach, y - reach, reach * 2, reach * 2);
  }
  drawingContext.globalAlpha = alpha * smooth(grow * 1.5);
  drawingContext.fillStyle = palette.text;
  drawingContext.beginPath();
  drawingContext.arc(x, y, radius * (0.4 + 0.6 * growth), 0, FULL_TURN_RADIANS);
  drawingContext.fill();
  if (vega) {
    drawingContext.globalAlpha = VEGA_RING_ALPHA * growth;
    drawingContext.strokeStyle = palette.sky;
    drawingContext.lineWidth = 0.7;
    drawingContext.beginPath();
    drawingContext.arc(x, y, VEGA_RING_RADIUS * (0.6 + 0.4 * growth), 0, FULL_TURN_RADIANS);
    drawingContext.stroke();
  }
  drawingContext.globalAlpha = 1;
}

function edgeStyle(
  drawingContext: CanvasRenderingContext2D,
  palette: Palette,
  progress: number,
  hot: boolean,
  alpha: number,
): void {
  drawingContext.lineCap = "round";
  drawingContext.strokeStyle = hot ? palette.sky : palette.metadata;
  drawingContext.globalAlpha = (hot ? HOT_EDGE_ALPHA : alpha) * smooth(progress * 2);
  drawingContext.lineWidth = hot ? 1.1 : 0.65;
}

/** A straight edge drawn in from a to b. `progress` 0..1 is the draw-in share. */
export function drawEdge(
  drawingContext: CanvasRenderingContext2D,
  palette: Palette,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  progress: number,
  hot: boolean,
  alpha: number,
): void {
  if (progress <= 0) return;
  const growth = easeOutCubic(clamp(progress));
  edgeStyle(drawingContext, palette, progress, hot, alpha);
  drawingContext.beginPath();
  drawingContext.moveTo(ax, ay);
  drawingContext.lineTo(ax + (bx - ax) * growth, ay + (by - ay) * growth);
  drawingContext.stroke();
  drawingContext.globalAlpha = 1;
}

/** A cubic Bezier edge drawn in from a to b. It is split at the draw-in share by de Casteljau. */
export function drawCurve(
  drawingContext: CanvasRenderingContext2D,
  palette: Palette,
  ax: number,
  ay: number,
  c1x: number,
  c1y: number,
  c2x: number,
  c2y: number,
  bx: number,
  by: number,
  progress: number,
  hot: boolean,
  alpha: number,
): void {
  if (progress <= 0) return;
  const growth = easeOutCubic(clamp(progress));
  const q0x = ax + (c1x - ax) * growth;
  const q0y = ay + (c1y - ay) * growth;
  const q1x = c1x + (c2x - c1x) * growth;
  const q1y = c1y + (c2y - c1y) * growth;
  const q2x = c2x + (bx - c2x) * growth;
  const q2y = c2y + (by - c2y) * growth;
  const r0x = q0x + (q1x - q0x) * growth;
  const r0y = q0y + (q1y - q0y) * growth;
  const r1x = q1x + (q2x - q1x) * growth;
  const r1y = q1y + (q2y - q1y) * growth;
  edgeStyle(drawingContext, palette, progress, hot, alpha);
  drawingContext.beginPath();
  drawingContext.moveTo(ax, ay);
  drawingContext.bezierCurveTo(q0x, q0y, r0x, r0y, r0x + (r1x - r0x) * growth, r0y + (r1y - r0y) * growth);
  drawingContext.stroke();
  drawingContext.globalAlpha = 1;
}

/** The size of the Vega bloom. */
const BLOOM_SIZE = 60;

/** The strength of the Vega bloom during an entrance: it swells as the comets arrive and clears by the end. */
export function entranceBloom(progress: number): number {
  return riseAndFall(progress, 0.62, 0.22, 0.84, 0.16);
}

/** The Vega bloom: added light, strength 0..1. It swells as comets arrive and clears by the end. */
export function drawVegaBloom(
  drawingContext: CanvasRenderingContext2D,
  glow: HTMLCanvasElement,
  x: number,
  y: number,
  strength: number,
): void {
  if (strength <= 0) return;
  const previousCompositeOperation = drawingContext.globalCompositeOperation;
  drawingContext.globalCompositeOperation = "lighter";
  drawingContext.globalAlpha = 0.5 * strength;
  drawingContext.drawImage(glow, x - BLOOM_SIZE / 2, y - BLOOM_SIZE / 2, BLOOM_SIZE, BLOOM_SIZE);
  drawingContext.globalAlpha = 1;
  drawingContext.globalCompositeOperation = previousCompositeOperation;
}
