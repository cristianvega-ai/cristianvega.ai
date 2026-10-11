import { clamp, riseAndFall } from "./easing.ts";
import { FULL_TURN_RADIANS, type Point } from "./geometry.ts";
import type { Palette } from "./palette.ts";

// Comets: light that runs along a route, for the globe and the page graphics.
// A comet draws with no allocation and restores the blend mode.

/** A comet route: a polyline with running lengths. Build it on resize. */
export interface Route {
  points: Point[];
  /** The length of the route up to each point. */
  lengths: number[];
  length: number;
}

/** Build a route through `points`. To follow a curve, pass many samples of it. */
export function makeRoute(points: readonly Point[]): Route {
  const lengths = [0];
  for (let pointIndex = 1; pointIndex < points.length; pointIndex++) {
    lengths.push(lengths[pointIndex - 1] + Math.hypot(points[pointIndex].x - points[pointIndex - 1].x, points[pointIndex].y - points[pointIndex - 1].y));
  }
  return { points: points.map(({ x, y }) => ({ x, y })), lengths, length: lengths[lengths.length - 1] };
}

// Scratch points, so a frame allocates nothing.
const head: Point = { x: 0, y: 0 };
const tailStart: Point = { x: 0, y: 0 };
const tailEnd: Point = { x: 0, y: 0 };

function routePoint(route: Route, distance: number, outputPoint: Point): Point {
  const { points, lengths } = route;
  let segmentIndex = 1;
  while (segmentIndex < lengths.length - 1 && lengths[segmentIndex] < distance) segmentIndex++;
  const span = lengths[segmentIndex] - lengths[segmentIndex - 1];
  const share = span > 0 ? clamp((distance - lengths[segmentIndex - 1]) / span) : 1;
  outputPoint.x = points[segmentIndex - 1].x + (points[segmentIndex].x - points[segmentIndex - 1].x) * share;
  outputPoint.y = points[segmentIndex - 1].y + (points[segmentIndex].y - points[segmentIndex - 1].y) * share;
  return outputPoint;
}

const TAIL_SLICES = 16;
/** The size of the glow on a comet head. */
const COMET_GLOW = 26;

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
  tail: number,
): void {
  if (travel <= 0 || travel >= 1 || route.length <= 0) return;
  const distance = route.length * (1 - (1 - travel) ** 1.6);
  const strength = riseAndFall(travel, 0, 0.16, 0.86, 0.14);
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
  drawingContext.drawImage(glow, head.x - COMET_GLOW / 2, head.y - COMET_GLOW / 2, COMET_GLOW, COMET_GLOW);
  drawingContext.globalAlpha = strength;
  drawingContext.fillStyle = palette.text;
  drawingContext.beginPath();
  drawingContext.arc(head.x, head.y, 1.2, 0, FULL_TURN_RADIANS);
  drawingContext.fill();
  drawingContext.globalAlpha = 1;
  drawingContext.globalCompositeOperation = previousCompositeOperation;
}
