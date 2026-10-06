import type { Point } from "../motion/easing.ts";
import { clamp, easeOutCubic, smooth, TAU, unit } from "./math.ts";
import type { Palette } from "./palette.ts";

// Drawing marks for the page graphics, in the language of the homepage globe.
// Sizes are CSS pixels. Every mark draws with no allocation, so a frame is cheap.
// Each mark leaves globalAlpha at 1, and the comet restores the blend mode.

/** A neuron: a soft halo when hot (`halo` 0..1 sets its strength), a bright core, and an extra ring on Vega. `grow` 0..1 is the appear share. */
export function drawNode(
  ctx: CanvasRenderingContext2D,
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
    const reach = (vega ? 18 : 8) * g;
    ctx.globalAlpha = g * halo;
    ctx.drawImage(glow, x - reach, y - reach, reach * 2, reach * 2);
  }
  ctx.globalAlpha = alpha * smooth(grow * 1.5);
  ctx.fillStyle = palette.text;
  ctx.beginPath();
  ctx.arc(x, y, radius * (0.4 + 0.6 * g), 0, TAU);
  ctx.fill();
  if (vega) {
    ctx.globalAlpha = 0.6 * g;
    ctx.strokeStyle = palette.sky;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.arc(x, y, 10 * (0.6 + 0.4 * g), 0, TAU);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function edgeStyle(ctx: CanvasRenderingContext2D, palette: Palette, t: number, hot: boolean, alpha: number): void {
  ctx.lineCap = "round";
  ctx.strokeStyle = hot ? palette.sky : palette.meta;
  ctx.globalAlpha = (hot ? 0.7 : alpha) * smooth(t * 2);
  ctx.lineWidth = hot ? 1.1 : 0.65;
}

/** A straight edge drawn in from a to b. `t` 0..1 is the draw-in share. */
export function drawEdge(
  ctx: CanvasRenderingContext2D,
  palette: Palette,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  t: number,
  hot = false,
  alpha = 0.35,
): void {
  if (t <= 0) return;
  const g = easeOutCubic(clamp(t));
  edgeStyle(ctx, palette, t, hot, alpha);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(ax + (bx - ax) * g, ay + (by - ay) * g);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** A cubic Bezier edge drawn in from a to b. It is split at the draw-in share by de Casteljau. */
export function drawCurve(
  ctx: CanvasRenderingContext2D,
  palette: Palette,
  ax: number,
  ay: number,
  c1x: number,
  c1y: number,
  c2x: number,
  c2y: number,
  bx: number,
  by: number,
  t: number,
  hot = false,
  alpha = 0.35,
): void {
  if (t <= 0) return;
  const g = easeOutCubic(clamp(t));
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
  edgeStyle(ctx, palette, t, hot, alpha);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.bezierCurveTo(q0x, q0y, r0x, r0y, r0x + (r1x - r0x) * g, r0y + (r1y - r0y) * g);
  ctx.stroke();
  ctx.globalAlpha = 1;
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
  const n = points.length;
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  const lengths = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = points[i].x;
    ys[i] = points[i].y;
    if (i) lengths[i] = lengths[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
  }
  return { xs, ys, lengths, length: lengths[n - 1] };
}

// Scratch points, so a frame allocates nothing.
const head: Point = { x: 0, y: 0 };
const tailStart: Point = { x: 0, y: 0 };
const tailEnd: Point = { x: 0, y: 0 };

function routePoint(route: Route, distance: number, out: Point): Point {
  const { xs, ys, lengths } = route;
  let i = 1;
  while (i < lengths.length - 1 && lengths[i] < distance) i++;
  const span = lengths[i] - lengths[i - 1];
  const share = span > 0 ? clamp((distance - lengths[i - 1]) / span) : 1;
  out.x = xs[i - 1] + (xs[i] - xs[i - 1]) * share;
  out.y = ys[i - 1] + (ys[i] - ys[i - 1]) * share;
  return out;
}

const TAIL_SLICES = 16;

/**
 * A comet with a fading tail, drawn with added light. `travel` 0..1 runs along the route.
 * It eases in, slows on arrival, and does not show outside (0, 1).
 */
export function drawComet(
  ctx: CanvasRenderingContext2D,
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
  const previousOp = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  ctx.strokeStyle = palette.sky;
  routePoint(route, distance, head);
  tailStart.x = head.x;
  tailStart.y = head.y;
  for (let slice = 1; slice <= TAIL_SLICES; slice++) {
    const behind = distance - (slice / TAIL_SLICES) * tail;
    if (behind < 0) break;
    const fade = 1 - slice / TAIL_SLICES;
    routePoint(route, behind, tailEnd);
    ctx.globalAlpha = 0.75 * strength * fade * fade;
    ctx.lineWidth = 0.5 + 1.3 * fade;
    ctx.beginPath();
    ctx.moveTo(tailStart.x, tailStart.y);
    ctx.lineTo(tailEnd.x, tailEnd.y);
    ctx.stroke();
    tailStart.x = tailEnd.x;
    tailStart.y = tailEnd.y;
  }
  ctx.globalAlpha = 0.85 * strength;
  ctx.drawImage(glow, head.x - glowSize / 2, head.y - glowSize / 2, glowSize, glowSize);
  ctx.globalAlpha = strength;
  ctx.fillStyle = palette.text;
  ctx.beginPath();
  ctx.arc(head.x, head.y, 1.2, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = previousOp;
}

/** The width of the ink halo round a label. */
const HALO_WIDTH = 3.5;

/** A label at a fixed CSS pixel size. An ink halo in the page ground colour knocks out the lines under it. */
export function drawLabel(
  ctx: CanvasRenderingContext2D,
  palette: Palette,
  canvasFont: string,
  text: string,
  x: number,
  y: number,
  align: CanvasTextAlign = "left",
  alpha = 1,
): void {
  if (alpha <= 0) return;
  ctx.font = canvasFont;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = HALO_WIDTH;
  ctx.strokeStyle = palette.ink;
  ctx.globalAlpha = alpha;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = palette.meta;
  ctx.globalAlpha = alpha;
  ctx.fillText(text, x, y);
  ctx.globalAlpha = 1;
}

/** The Vega bloom: added light, strength 0..1. It swells as comets arrive and clears by the end. */
export function drawVegaBloom(
  ctx: CanvasRenderingContext2D,
  glow: HTMLCanvasElement,
  x: number,
  y: number,
  strength: number,
  size = 60,
): void {
  if (strength <= 0) return;
  const previousOp = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.5 * strength;
  ctx.drawImage(glow, x - size / 2, y - size / 2, size, size);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = previousOp;
}

export interface FieldStar {
  x: number;
  y: number;
  radius: number;
  alpha: number;
}

/** Field stars fixed by a seed. Build them on resize. */
export function makeStarField(w: number, h: number, count: number, seed = 0): FieldStar[] {
  const field: FieldStar[] = [];
  for (let i = 0; i < count; i++) {
    field.push({
      x: unit(i * 3 + seed) * w,
      y: unit(i * 3 + 1 + seed) * h,
      radius: 0.5 + unit(i * 3 + 2 + seed) * 0.8,
      alpha: 0.15 + unit(i * 7 + seed) * 0.35,
    });
  }
  return field;
}

export function drawStarField(ctx: CanvasRenderingContext2D, palette: Palette, field: readonly FieldStar[], progress: number): void {
  const fadeIn = smooth(progress / 0.5);
  ctx.fillStyle = palette.meta;
  for (let i = 0; i < field.length; i++) {
    const star = field[i];
    ctx.globalAlpha = star.alpha * fadeIn;
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.radius, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
