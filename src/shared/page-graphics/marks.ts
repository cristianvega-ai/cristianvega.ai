import type { Point } from "../motion/easing.ts";
import { clamp, easeOutCubic, smooth, FULL_TURN_RADIANS, unit } from "./math.ts";
import type { Palette } from "../motion/palette.ts";

// Drawing marks for the page graphics, in the language of the homepage globe.
// Sizes are CSS pixels. Every mark draws with no allocation, so a frame is cheap.
// Each mark leaves globalAlpha at 1, and the comet restores the blend mode.

/** The halo reach of a hot neuron and of Vega, in CSS pixels. */
export const NODE_HALO = 8;
export const VEGA_HALO = 18;

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
  const g = easeOutCubic(grow);
  if (hot && halo > 0) {
    const reach = (vega ? VEGA_HALO : NODE_HALO) * g;
    drawingContext.globalAlpha = g * halo;
    drawingContext.drawImage(glow, x - reach, y - reach, reach * 2, reach * 2);
  }
  drawingContext.globalAlpha = alpha * smooth(grow * 1.5);
  drawingContext.fillStyle = palette.text;
  drawingContext.beginPath();
  drawingContext.arc(x, y, radius * (0.4 + 0.6 * g), 0, FULL_TURN_RADIANS);
  drawingContext.fill();
  if (vega) {
    drawingContext.globalAlpha = 0.6 * g;
    drawingContext.strokeStyle = palette.sky;
    drawingContext.lineWidth = 0.7;
    drawingContext.beginPath();
    drawingContext.arc(x, y, 10 * (0.6 + 0.4 * g), 0, FULL_TURN_RADIANS);
    drawingContext.stroke();
  }
  drawingContext.globalAlpha = 1;
}

function edgeStyle(drawingContext: CanvasRenderingContext2D, palette: Palette, t: number, hot: boolean, alpha: number): void {
  drawingContext.lineCap = "round";
  drawingContext.strokeStyle = hot ? palette.sky : palette.metadata;
  drawingContext.globalAlpha = (hot ? 0.7 : alpha) * smooth(t * 2);
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
  hot = false,
  alpha = 0.35,
): void {
  if (progress <= 0) return;
  const g = easeOutCubic(clamp(progress));
  edgeStyle(drawingContext, palette, progress, hot, alpha);
  drawingContext.beginPath();
  drawingContext.moveTo(ax, ay);
  drawingContext.lineTo(ax + (bx - ax) * g, ay + (by - ay) * g);
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
  hot = false,
  alpha = 0.35,
): void {
  if (progress <= 0) return;
  const g = easeOutCubic(clamp(progress));
  const q0x = ax + (c1x - ax) * g;
  const q0y = ay + (c1y - ay) * g;
  const q1x = c1x + (c2x - c1x) * g;
  const q1y = c1y + (c2y - c1y) * g;
  const q2x = c2x + (bx - c2x) * g;
  const q2y = c2y + (by - c2y) * g;
  const r0x = q0x + (q1x - q0x) * g;
  const r0y = q0y + (q1y - q0y) * g;
  const r1x = q1x + (q2x - q1x) * g;
  const r1y = q1y + (q2y - q1y) * g;
  edgeStyle(drawingContext, palette, progress, hot, alpha);
  drawingContext.beginPath();
  drawingContext.moveTo(ax, ay);
  drawingContext.bezierCurveTo(q0x, q0y, r0x, r0y, r0x + (r1x - r0x) * g, r0y + (r1y - r0y) * g);
  drawingContext.stroke();
  drawingContext.globalAlpha = 1;
}

/** A comet route: a polyline with running lengths. Build it on resize. */
export interface Route {
  xs: Float32Array;
  ys: Float32Array;
  lengths: Float32Array;
  length: number;
}

/** Build a route through `points`. To follow a curve, pass many samples of it. */
export function makeRoute(points: readonly Point[]): Route {
  const pointCount = points.length;
  const xs = new Float32Array(pointCount);
  const ys = new Float32Array(pointCount);
  const lengths = new Float32Array(pointCount);
  for (let i = 0; i < pointCount; i++) {
    xs[i] = points[i].x;
    ys[i] = points[i].y;
    if (i) lengths[i] = lengths[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
  }
  return { xs, ys, lengths, length: lengths[pointCount - 1] };
}

// Scratch points, so a frame allocates nothing.
const head: Point = { x: 0, y: 0 };
const tailStart: Point = { x: 0, y: 0 };
const tailEnd: Point = { x: 0, y: 0 };

function routePoint(route: Route, distance: number, outputPoint: Point): Point {
  const { xs, ys, lengths } = route;
  let i = 1;
  while (i < lengths.length - 1 && lengths[i] < distance) i++;
  const span = lengths[i] - lengths[i - 1];
  const share = span > 0 ? clamp((distance - lengths[i - 1]) / span) : 1;
  outputPoint.x = xs[i - 1] + (xs[i] - xs[i - 1]) * share;
  outputPoint.y = ys[i - 1] + (ys[i] - ys[i - 1]) * share;
  return outputPoint;
}

const TAIL_SLICES = 16;

/**
 * A comet with a fading tail, drawn with added light. `travel` 0..1 runs along the route.
 * It eases in, slows on arrival, and does not show outside (0, 1).
 */
export function drawComet(
  drawingContext: CanvasRenderingContext2D,
  palette: Palette,
  glow: HTMLCanvasElement,
  route: Route,
  travel: number,
  tail = 90,
  glowSize = 26,
): void {
  if (travel <= 0 || travel >= 1 || route.length <= 0) return;
  const distance = route.length * (1 - (1 - travel) ** 1.6);
  const strength = smooth(travel / 0.16) * (1 - smooth((travel - 0.86) / 0.14));
  const previousCompositeOperation = drawingContext.globalCompositeOperation;
  drawingContext.globalCompositeOperation = "lighter";
  drawingContext.lineCap = "round";
  drawingContext.strokeStyle = palette.sky;
  routePoint(route, distance, head);
  tailStart.x = head.x;
  tailStart.y = head.y;
  for (let slice = 1; slice <= TAIL_SLICES; slice++) {
    const behind = distance - (slice / TAIL_SLICES) * tail;
    if (behind < 0) break;
    const fade = 1 - slice / TAIL_SLICES;
    routePoint(route, behind, tailEnd);
    drawingContext.globalAlpha = 0.75 * strength * fade * fade;
    drawingContext.lineWidth = 0.5 + 1.3 * fade;
    drawingContext.beginPath();
    drawingContext.moveTo(tailStart.x, tailStart.y);
    drawingContext.lineTo(tailEnd.x, tailEnd.y);
    drawingContext.stroke();
    tailStart.x = tailEnd.x;
    tailStart.y = tailEnd.y;
  }
  drawingContext.globalAlpha = 0.85 * strength;
  drawingContext.drawImage(glow, head.x - glowSize / 2, head.y - glowSize / 2, glowSize, glowSize);
  drawingContext.globalAlpha = strength;
  drawingContext.fillStyle = palette.text;
  drawingContext.beginPath();
  drawingContext.arc(head.x, head.y, 1.2, 0, FULL_TURN_RADIANS);
  drawingContext.fill();
  drawingContext.globalAlpha = 1;
  drawingContext.globalCompositeOperation = previousCompositeOperation;
}

/** The width of the ink halo round a label. */
const HALO_WIDTH = 3.5;

/** A label at a fixed CSS pixel size. An ink halo in the page ground colour knocks out the lines under it. */
export function drawLabel(
  drawingContext: CanvasRenderingContext2D,
  palette: Palette,
  canvasFont: string,
  text: string,
  x: number,
  y: number,
  align: CanvasTextAlign = "left",
  alpha = 1,
): void {
  if (alpha <= 0) return;
  drawingContext.font = canvasFont;
  drawingContext.textAlign = align;
  drawingContext.textBaseline = "middle";
  drawingContext.lineJoin = "round";
  drawingContext.lineWidth = HALO_WIDTH;
  drawingContext.strokeStyle = palette.ink;
  drawingContext.globalAlpha = alpha;
  drawingContext.strokeText(text, x, y);
  drawingContext.fillStyle = palette.metadata;
  drawingContext.globalAlpha = alpha;
  drawingContext.fillText(text, x, y);
  drawingContext.globalAlpha = 1;
}

/** The Vega bloom: added light, strength 0..1. It swells as comets arrive and clears by the end. */
export function drawVegaBloom(
  drawingContext: CanvasRenderingContext2D,
  glow: HTMLCanvasElement,
  x: number,
  y: number,
  strength: number,
  size = 60,
): void {
  if (strength <= 0) return;
  const previousCompositeOperation = drawingContext.globalCompositeOperation;
  drawingContext.globalCompositeOperation = "lighter";
  drawingContext.globalAlpha = 0.5 * strength;
  drawingContext.drawImage(glow, x - size / 2, y - size / 2, size, size);
  drawingContext.globalAlpha = 1;
  drawingContext.globalCompositeOperation = previousCompositeOperation;
}

export interface FieldStar {
  x: number;
  y: number;
  radius: number;
  alpha: number;
}

/** Field stars fixed by a seed. Build them on resize. */
export function makeStarField(width: number, height: number, count: number, seed = 0): FieldStar[] {
  const field: FieldStar[] = [];
  for (let i = 0; i < count; i++) {
    field.push({
      x: unit(i * 3 + seed) * width,
      y: unit(i * 3 + 1 + seed) * height,
      radius: 0.5 + unit(i * 3 + 2 + seed) * 0.8,
      alpha: 0.15 + unit(i * 7 + seed) * 0.35,
    });
  }
  return field;
}

export function drawStarField(drawingContext: CanvasRenderingContext2D, palette: Palette, field: readonly FieldStar[], progress: number): void {
  const fadeIn = smooth(progress / 0.5);
  drawingContext.fillStyle = palette.metadata;
  for (let i = 0; i < field.length; i++) {
    const star = field[i];
    drawingContext.globalAlpha = star.alpha * fadeIn;
    drawingContext.beginPath();
    drawingContext.arc(star.x, star.y, star.radius, 0, FULL_TURN_RADIANS);
    drawingContext.fill();
  }
  drawingContext.globalAlpha = 1;
}
