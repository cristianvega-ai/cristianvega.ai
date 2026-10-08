import { FIGURE_INSET } from "./inset.ts";
import { FALLBACK_LINE_HEIGHT_IN_PIXELS } from "./label-font.ts";

// Label placement for the page graphics. It has no DOM read in `placeLabel`, so a test can run it.
// A label takes the first side of its node (right, left, above, or below) that no edge crosses,
// that no other mark covers, and that stays inside the allowed area. Call it on resize, not per frame.

export interface Rectangle {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A straight line that a label must not cross. */
export interface Segment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export type LabelAlign = "left" | "right" | "center";
export type LabelSide = "right" | "left" | "above" | "below" | "above-right" | "above-left" | "below-right" | "below-left";

export interface PlacedLabel {
  text: string;
  x: number;
  y: number;
  align: LabelAlign;
  /** The box the label covers, with its halo. */
  rectangle: Rectangle;
  side: LabelSide;
  /** True when the place is free of edges and marks and inside the bounds. */
  clear: boolean;
}

const HALO_PADDING = 3;
/** The space that a label keeps from the canvas edge. It is the figure inset, so a label follows the one bounding rule. */
export const EDGE_INSET = FIGURE_INSET;
/** The space that a label keeps from the viewport edge. */
export const VIEWPORT_INSET = 32;
/** The weight of a crossing. A hard crossing must lose to no free place, and a soft one only breaks a tie. */
const HARD = 100;
const SOFT = 1;
/** A label on a mark or another label reads worse than a label on a line, so it costs more. */
const MARK = 1000;
const OUTSIDE = 10_000;

const SIDES: readonly LabelSide[] = ["right", "left", "above", "below", "above-right", "above-left", "below-right", "below-left"];

export function rectanglesOverlap(a: Rectangle, b: Rectangle): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/** A square round a point, for a mark that labels must keep clear. */
export function around(x: number, y: number, reach: number): Rectangle {
  return { x0: x - reach, y0: y - reach, x1: x + reach, y1: y + reach };
}

/** True when the segment touches the rectangle (Liang-Barsky clip). */
export function segmentIntersectsRectangle(segment: Segment, rectangle: Rectangle): boolean {
  const dx = segment.bx - segment.ax;
  const dy = segment.by - segment.ay;
  let t0 = 0;
  let t1 = 1;
  const edges = [
    [-dx, segment.ax - rectangle.x0],
    [dx, rectangle.x1 - segment.ax],
    [-dy, segment.ay - rectangle.y0],
    [dy, rectangle.y1 - segment.ay],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return false;
        t0 = Math.max(t0, r);
      } else {
        if (r < t0) return false;
        t1 = Math.min(t1, r);
      }
    }
  }
  return true;
}

/** Turn a run of points into the segments between them. Flat arrays: x0, y0, x1, y1, and so on. */
export function polylineSegments(xs: ArrayLike<number>, ys: ArrayLike<number>, outputSegments: Segment[] = []): Segment[] {
  for (let i = 1; i < xs.length; i++) outputSegments.push({ ax: xs[i - 1], ay: ys[i - 1], bx: xs[i], by: ys[i] });
  return outputSegments;
}

/** Sample an ellipse into segments, so a label can avoid a ring. */
export function ellipseSegments(cx: number, cy: number, rx: number, ry: number, steps = 40, outputSegments: Segment[] = []): Segment[] {
  let px = cx + rx;
  let py = cy;
  for (let i = 1; i <= steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    const x = cx + Math.cos(angle) * rx;
    const y = cy + Math.sin(angle) * ry;
    outputSegments.push({ ax: px, ay: py, bx: x, by: y });
    px = x;
    py = y;
  }
  return outputSegments;
}

export interface PlaceOptions {
  /** The measured text width in CSS pixels, without the halo. */
  widthInPixels: number;
  /**
   * The height of one label line in CSS pixels, without the halo. Pass labelFont.lineHeightInPixels, so the box follows
   * the --fs-graphic-label token. It defaults to the line of the fallback label size.
   */
  lineHeightInPixels?: number;
  /** The area that the label box must stay inside. */
  bounds: Rectangle;
  /** Edges that must stay clear of the label. A node's own edges belong here. */
  segments?: readonly Segment[];
  /** Lines that only break a tie, such as orbit rings. */
  soft?: readonly Segment[];
  /** Marks and earlier labels to keep clear. The chosen box is appended, so the next label avoids it. */
  avoid?: Rectangle[];
  /** The space between the node and the text, in CSS pixels. */
  gap?: number;
  /** The order of sides to try. */
  prefer?: readonly LabelSide[];
  /** Move the label along its side, for example above the node's own line. */
  lift?: number;
}

function candidate(text: string, x: number, y: number, side: LabelSide, width: number, line: number, gap: number, lift: number): PlacedLabel {
  const rise = gap + line / 2;
  const corner = gap * 0.75;
  let cx = x;
  let cy = y + lift;
  let align: LabelAlign = "center";
  switch (side) {
    case "right":
      cx = x + gap;
      align = "left";
      break;
    case "left":
      cx = x - gap;
      align = "right";
      break;
    case "above":
      cy = y - rise;
      break;
    case "below":
      cy = y + rise;
      break;
    case "above-right":
      cx = x + corner;
      cy = y - rise;
      align = "left";
      break;
    case "above-left":
      cx = x - corner;
      cy = y - rise;
      align = "right";
      break;
    case "below-right":
      cx = x + corner;
      cy = y + rise;
      align = "left";
      break;
    case "below-left":
      cx = x - corner;
      cy = y + rise;
      align = "right";
      break;
  }
  const left = align === "left" ? cx : align === "right" ? cx - width : cx - width / 2;
  return {
    text,
    x: cx,
    y: cy,
    align,
    side,
    clear: false,
    rectangle: { x0: left - HALO_PADDING, y0: cy - line / 2 - HALO_PADDING, x1: left + width + HALO_PADDING, y1: cy + line / 2 + HALO_PADDING },
  };
}

function cost(label: PlacedLabel, options: PlaceOptions): number {
  const { rectangle } = label;
  const { bounds } = options;
  let total = 0;
  if (rectangle.x0 < bounds.x0) total += OUTSIDE + (bounds.x0 - rectangle.x0);
  if (rectangle.x1 > bounds.x1) total += OUTSIDE + (rectangle.x1 - bounds.x1);
  if (rectangle.y0 < bounds.y0) total += OUTSIDE + (bounds.y0 - rectangle.y0);
  if (rectangle.y1 > bounds.y1) total += OUTSIDE + (rectangle.y1 - bounds.y1);
  for (const segment of options.segments ?? []) if (segmentIntersectsRectangle(segment, rectangle)) total += HARD;
  for (const other of options.avoid ?? []) if (rectanglesOverlap(other, rectangle)) total += MARK;
  for (const segment of options.soft ?? []) if (segmentIntersectsRectangle(segment, rectangle)) total += SOFT;
  return total;
}

/**
 * Place the label of the node at (x, y). It tries the sides in order and takes the first that costs nothing.
 * When none is free, it takes the cheapest, so a label always has a place, and `clear` says whether it is free.
 */
export function placeLabel(text: string, x: number, y: number, options: PlaceOptions): PlacedLabel {
  const { gap = 12, prefer = SIDES, widthInPixels, lineHeightInPixels = FALLBACK_LINE_HEIGHT_IN_PIXELS, lift = 0 } = options;
  const order = prefer.length >= SIDES.length ? prefer : [...prefer, ...SIDES.filter((side) => !prefer.includes(side))];
  let best: PlacedLabel | undefined;
  let bestCost = Infinity;
  for (const side of order) {
    const label = candidate(text, x, y, side, widthInPixels, lineHeightInPixels, gap, side === "right" || side === "left" ? lift : 0);
    const price = cost(label, options);
    if (price < bestCost) {
      best = label;
      bestCost = price;
    }
    if (price === 0) break;
  }
  const chosen = best as PlacedLabel;
  chosen.clear = bestCost < HARD;
  options.avoid?.push(chosen.rectangle);
  return chosen;
}

/**
 * The area for labels, in canvas pixels: inside the edge fade, and at least `VIEWPORT_INSET` from the
 * viewport edge. `originX` is the shift of the drawing origin in the canvas. It reads the DOM, so call it on resize.
 */
export function labelBounds(container: HTMLElement, width: number, height: number, originX = 0): Rectangle {
  const box = container.getBoundingClientRect();
  const left = box.left + originX;
  const viewport = document.documentElement.clientWidth;
  // A short band gets a smaller top and bottom inset, so the label of a star near its edge still has a place.
  const inset = Math.min(EDGE_INSET, Math.max(20, height * 0.14));
  return {
    x0: Math.max(EDGE_INSET, VIEWPORT_INSET - left),
    y0: inset,
    x1: Math.min(width - originX - EDGE_INSET, viewport - VIEWPORT_INSET - left),
    y1: height - inset,
  };
}
