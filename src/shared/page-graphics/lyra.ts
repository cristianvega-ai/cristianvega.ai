import { LYRA, LYRA_LINKS } from "../lyra/constellation.ts";
import type { Point } from "../canvas/geometry.ts";
import type { LabelFont } from "./label-font.ts";
import { placeLabel, type PlacedLabel, type Rectangle, type Segment } from "./labels.ts";

// The Lyra figure on a page graphic: how it fits a box, and where its star names go.
// Call these on resize, not per frame.

export interface LyraPoint {
  x: number;
  y: number;
  name: string | undefined;
  /** True for Vega, the brightest star of the figure. */
  vega: boolean;
}

/** The longest side of the figure on any canvas, in CSS pixels. A tall canvas gets a margin, not a bigger figure. */
export const LYRA_MAXIMUM_SIZE = 280;

interface LyraLayoutOptions {
  /** Empty space kept round the figure, in CSS pixels. */
  padding?: number;
  /** Turn the figure by this angle, in radians, before it is fitted. */
  rotation?: number;
  /** Reuse this array to avoid an allocation. */
  outputPoints?: LyraPoint[];
}

/** The chart offsets of the figure turned by `rotation` radians. Vega stays at the origin. */
function turnLyra(rotation: number): Point[] {
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  return LYRA.map((star) => ({ x: star.x * cosine - star.y * sine, y: star.x * sine + star.y * cosine }));
}

/** The smallest rectangle that holds every point. */
export function boundsOf(points: readonly Point[]): Rectangle {
  const bounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const point of points) {
    bounds.x0 = Math.min(bounds.x0, point.x);
    bounds.x1 = Math.max(bounds.x1, point.x);
    bounds.y0 = Math.min(bounds.y0, point.y);
    bounds.y1 = Math.max(bounds.y1, point.y);
  }
  return bounds;
}

/**
 * Fit the Lyra figure into the supplied width and height with one uniform scale. The proportions stay the same on every
 * canvas. The figure never grows past LYRA_MAXIMUM_SIZE, so it sits centred in a tall or wide box with space round it.
 */
export function layoutLyra(
  width: number,
  height: number,
  { padding = 16, rotation = 0, outputPoints = [] }: LyraLayoutOptions = {},
): LyraPoint[] {
  const turned = turnLyra(rotation);
  const { x0: minimumX, x1: maximumX, y0: minimumY, y1: maximumY } = boundsOf(turned);
  const scale = Math.min((width - padding * 2) / (maximumX - minimumX || 1), (height - padding * 2) / (maximumY - minimumY || 1), LYRA_MAXIMUM_SIZE / Math.max(maximumX - minimumX, maximumY - minimumY, 1e-9));
  const offsetX = (width - (maximumX - minimumX) * scale) / 2 - minimumX * scale;
  const offsetY = (height - (maximumY - minimumY) * scale) / 2 - minimumY * scale;
  turned.forEach((turnedPoint, starIndex) => {
    const point = outputPoints[starIndex] ?? (outputPoints[starIndex] = { x: 0, y: 0, name: undefined, vega: false });
    point.x = turnedPoint.x * scale + offsetX;
    point.y = turnedPoint.y * scale + offsetY;
    point.name = LYRA[starIndex].name;
    point.vega = starIndex === 0;
  });
  return outputPoints;
}

/**
 * Fit the Lyra figure with Vega at the centre (centerX, centerY) so the figure stays inside the
 * half box (halfWidth, halfHeight), with one uniform scale and a cap on its size. A wide box turns the figure a
 * quarter turn. Fills `output` and returns it.
 */
export function fitLyraAtVega(
  output: Point[],
  centerX: number,
  centerY: number,
  halfWidth: number,
  halfHeight: number,
  wide: boolean,
): Point[] {
  const turned = turnLyra(wide ? -Math.PI / 2 : 0);
  const { x0: minimumX, x1: maximumX, y0: minimumY, y1: maximumY } = boundsOf(turned);
  let reachX = 0;
  let reachY = 0;
  for (const point of turned) {
    reachX = Math.max(reachX, Math.abs(point.x));
    reachY = Math.max(reachY, Math.abs(point.y));
  }
  // One uniform scale, and never bigger than the cap, so the figure has the same size and shape on every canvas.
  const scale = Math.min(halfWidth / reachX, halfHeight / reachY, LYRA_MAXIMUM_SIZE / Math.max(maximumX - minimumX, maximumY - minimumY));
  turned.forEach((turnedPoint, starIndex) => {
    const point = output[starIndex] ?? (output[starIndex] = { x: 0, y: 0 });
    point.x = centerX + turnedPoint.x * scale;
    point.y = centerY + turnedPoint.y * scale;
  });
  return output;
}

/** The links of the figure as segments, so a label can keep clear of them. */
export function lyraLinkSegments(stars: readonly Point[]): Segment[] {
  return LYRA_LINKS.map(([startIndex, endIndex]) => ({ startX: stars[startIndex].x, startY: stars[startIndex].y, endX: stars[endIndex].x, endY: stars[endIndex].y }));
}

/** The measured width of each star name, in Lyra star order. A star without a name measures 0. */
export function starNameWidths(labelFont: LabelFont): number[] {
  return LYRA.map((star) => star.name ? labelFont.widthInPixels(star.name) : 0);
}

interface StarNameOptions {
  /** The area that each name box must stay inside. */
  bounds: Rectangle;
  /** Vega always has its name. The other stars have theirs only when this is true. */
  showNames: boolean;
  /** The measured width of each name, from starNameWidths. */
  widthsInPixels: readonly number[];
  lineHeightInPixels: number;
  /** Lines that a name must not cross. */
  segments: readonly Segment[];
  /** Lines that only break a tie. */
  soft?: readonly Segment[];
  /** Marks to keep clear. Each placed name is appended. */
  avoid: Rectangle[];
}

/** Place the star names. Each takes the first side of its star that no line crosses. */
export function placeStarNames(stars: readonly Point[], { bounds, showNames, widthsInPixels, lineHeightInPixels, segments, soft, avoid }: StarNameOptions): PlacedLabel[] {
  const placed: PlacedLabel[] = [];
  LYRA.forEach((star, starIndex) => {
    const vega = starIndex === 0;
    if (!star.name || !(vega || showNames)) return;
    placed.push(placeLabel(star.name, stars[starIndex].x, stars[starIndex].y, {
      widthInPixels: widthsInPixels[starIndex],
      lineHeightInPixels,
      bounds,
      segments,
      soft,
      avoid,
      gap: vega ? 14 : 12,
    }));
  });
  return placed;
}
