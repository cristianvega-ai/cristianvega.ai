import type { Palette } from "../canvas/palette.ts";
import { FALLBACK_LINE_HEIGHT_IN_PIXELS } from "./label-font.ts";

// Labels for the page graphics: where each one goes, and how it draws. It has no DOM read, so a test
// can run it. A label takes the first side of its node (right, left, above, or below) that no edge crosses,
// that no other mark covers, and that stays inside the allowed area. Place labels on resize, not per frame.

export interface Rectangle {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A straight line that a label must not cross. */
export interface Segment {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
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
/** The weight of a crossing. A hard crossing must lose to no free place, and a soft one only breaks a tie. */
const HARD_CROSSING_COST = 100;
const SOFT_CROSSING_COST = 1;
/** A label on a mark or another label reads worse than a label on a line, so it costs more. */
const MARK_OVERLAP_COST = 1000;
const OUTSIDE_BOUNDS_COST = 10_000;

const SIDES: readonly LabelSide[] = ["right", "left", "above", "below", "above-right", "above-left", "below-right", "below-left"];

export function rectanglesOverlap(first: Rectangle, second: Rectangle): boolean {
  return first.x0 < second.x1 && second.x0 < first.x1 && first.y0 < second.y1 && second.y0 < first.y1;
}

/** A square round a point, for a mark that labels must keep clear. */
export function around(x: number, y: number, reach: number): Rectangle {
  return { x0: x - reach, y0: y - reach, x1: x + reach, y1: y + reach };
}

/** True when the segment touches the rectangle (Liang-Barsky clip). */
export function segmentIntersectsRectangle(segment: Segment, rectangle: Rectangle): boolean {
  const deltaX = segment.endX - segment.startX;
  const deltaY = segment.endY - segment.startY;
  let entering = 0;
  let leaving = 1;
  const clipBoundaries = [
    [-deltaX, segment.startX - rectangle.x0],
    [deltaX, rectangle.x1 - segment.startX],
    [-deltaY, segment.startY - rectangle.y0],
    [deltaY, rectangle.y1 - segment.startY],
  ];
  for (const [direction, distance] of clipBoundaries) {
    if (direction === 0) {
      if (distance < 0) return false;
    } else {
      const ratio = distance / direction;
      if (direction < 0) {
        if (ratio > leaving) return false;
        entering = Math.max(entering, ratio);
      } else {
        if (ratio < entering) return false;
        leaving = Math.min(leaving, ratio);
      }
    }
  }
  return true;
}

/** Turn a run of points into the segments between them. Flat arrays: x0, y0, x1, y1, and so on. */
export function polylineSegments(xValues: ArrayLike<number>, yValues: ArrayLike<number>, outputSegments: Segment[]): Segment[] {
  for (let pointIndex = 1; pointIndex < xValues.length; pointIndex++) outputSegments.push({ startX: xValues[pointIndex - 1], startY: yValues[pointIndex - 1], endX: xValues[pointIndex], endY: yValues[pointIndex] });
  return outputSegments;
}

/** Sample an ellipse into segments, so a label can avoid a ring. */
export function ellipseSegments(centerX: number, centerY: number, radiusX: number, radiusY: number, steps: number, outputSegments: Segment[]): Segment[] {
  let previousX = centerX + radiusX;
  let previousY = centerY;
  for (let stepIndex = 1; stepIndex <= steps; stepIndex++) {
    const angle = (stepIndex / steps) * Math.PI * 2;
    const x = centerX + Math.cos(angle) * radiusX;
    const y = centerY + Math.sin(angle) * radiusY;
    outputSegments.push({ startX: previousX, startY: previousY, endX: x, endY: y });
    previousX = x;
    previousY = y;
  }
  return outputSegments;
}

export interface PlaceOptions {
  /** The measured text width in CSS pixels, without the halo. */
  widthInPixels: number;
  /**
   * The height of one label line in CSS pixels, without the halo. Pass labelFont.lineHeightInPixels, so the box follows
   * the --font-size-graphic-label token. It defaults to the line of the fallback label size.
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

function candidate(text: string, x: number, y: number, side: LabelSide, width: number, lineHeight: number, gap: number, lift: number): PlacedLabel {
  const rise = gap + lineHeight / 2;
  const corner = gap * 0.75;
  let anchorX = x;
  let anchorY = y + lift;
  let align: LabelAlign = "center";
  switch (side) {
    case "right":
      anchorX = x + gap;
      align = "left";
      break;
    case "left":
      anchorX = x - gap;
      align = "right";
      break;
    case "above":
      anchorY = y - rise;
      break;
    case "below":
      anchorY = y + rise;
      break;
    case "above-right":
      anchorX = x + corner;
      anchorY = y - rise;
      align = "left";
      break;
    case "above-left":
      anchorX = x - corner;
      anchorY = y - rise;
      align = "right";
      break;
    case "below-right":
      anchorX = x + corner;
      anchorY = y + rise;
      align = "left";
      break;
    case "below-left":
      anchorX = x - corner;
      anchorY = y + rise;
      align = "right";
      break;
  }
  const left = align === "left" ? anchorX : align === "right" ? anchorX - width : anchorX - width / 2;
  return {
    text,
    x: anchorX,
    y: anchorY,
    align,
    side,
    clear: false,
    rectangle: { x0: left - HALO_PADDING, y0: anchorY - lineHeight / 2 - HALO_PADDING, x1: left + width + HALO_PADDING, y1: anchorY + lineHeight / 2 + HALO_PADDING },
  };
}

function cost(label: PlacedLabel, options: PlaceOptions): number {
  const { rectangle } = label;
  const { bounds } = options;
  let total = 0;
  if (rectangle.x0 < bounds.x0) total += OUTSIDE_BOUNDS_COST + (bounds.x0 - rectangle.x0);
  if (rectangle.x1 > bounds.x1) total += OUTSIDE_BOUNDS_COST + (rectangle.x1 - bounds.x1);
  if (rectangle.y0 < bounds.y0) total += OUTSIDE_BOUNDS_COST + (bounds.y0 - rectangle.y0);
  if (rectangle.y1 > bounds.y1) total += OUTSIDE_BOUNDS_COST + (rectangle.y1 - bounds.y1);
  for (const segment of options.segments ?? []) if (segmentIntersectsRectangle(segment, rectangle)) total += HARD_CROSSING_COST;
  for (const other of options.avoid ?? []) if (rectanglesOverlap(other, rectangle)) total += MARK_OVERLAP_COST;
  for (const segment of options.soft ?? []) if (segmentIntersectsRectangle(segment, rectangle)) total += SOFT_CROSSING_COST;
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
  chosen.clear = bestCost < HARD_CROSSING_COST;
  options.avoid?.push(chosen.rectangle);
  return chosen;
}

/** The width of the ink halo round a label. */
const HALO_WIDTH = 3.5;

/** Draw a placed label at a fixed CSS pixel size. An ink halo in the page ground colour knocks out the lines under it. */
export function drawLabel(
  drawingContext: CanvasRenderingContext2D,
  palette: Palette,
  canvasFont: string,
  label: PlacedLabel,
  alpha: number,
): void {
  if (alpha <= 0) return;
  setLabelText(drawingContext, canvasFont, label);
  drawingContext.lineJoin = "round";
  drawingContext.lineWidth = HALO_WIDTH;
  drawingContext.strokeStyle = palette.ink;
  drawingContext.globalAlpha = alpha;
  drawingContext.strokeText(label.text, label.x, label.y);
  drawingContext.fillStyle = palette.metadata;
  drawingContext.globalAlpha = alpha;
  drawingContext.fillText(label.text, label.x, label.y);
  drawingContext.globalAlpha = 1;
}

/** Draw each placed label. A null entry is a label with no clear place, and it does not draw. */
export function drawLabels(
  drawingContext: CanvasRenderingContext2D,
  palette: Palette,
  canvasFont: string,
  labels: readonly (PlacedLabel | null)[],
  alpha: number,
): void {
  for (let labelIndex = 0; labelIndex < labels.length; labelIndex++) {
    const label = labels[labelIndex];
    if (label) drawLabel(drawingContext, palette, canvasFont, label, alpha);
  }
}

/** Draw a placed label again in the text colour, over its plain draw, to light it. */
export function drawLabelHighlight(
  drawingContext: CanvasRenderingContext2D,
  palette: Palette,
  canvasFont: string,
  label: PlacedLabel,
  alpha: number,
): void {
  if (alpha <= 0) return;
  setLabelText(drawingContext, canvasFont, label);
  drawingContext.fillStyle = palette.text;
  drawingContext.globalAlpha = alpha;
  drawingContext.fillText(label.text, label.x, label.y);
  drawingContext.globalAlpha = 1;
}

function setLabelText(drawingContext: CanvasRenderingContext2D, canvasFont: string, label: PlacedLabel): void {
  drawingContext.font = canvasFont;
  drawingContext.textAlign = label.align;
  drawingContext.textBaseline = "middle";
}
