// The Lyra mark, drawn the way a star atlas draws it. Each dot has the size of
// the star's brightness, the figure lines stop short of the stars, and Vega
// is the one point of color. The mark centres the figure on its bounding box
// in a view box from -22 to 22.
import { LYRA } from "./constellation.ts";

/** The half width of the square view box. */
export const MARK_EXTENT = 22;

/** Degrees of sky to view-box units. */
const SCALE = 4.4;

/** The dot radius of each star in LYRA order. Brighter stars are larger. */
const STAR_RADII = [1.9, 0.9, 1.0, 1.0, 1.2, 1.3];

/** The space between a line end and a star edge. Vega keeps more room for its glow. */
const LINE_GAP = 1.1;
const VEGA_LINE_GAP = 3.5;

/** The halo radius around Vega. */
export const VEGA_HALO_RADIUS = 6;

/**
 * The figure lines in drawing order, as [from, to] star indices. Each line
 * runs toward Vega, from the foot of the figure up, so the entrance draws the
 * figure into Vega.
 */
export const FIGURE_STROKES = [
  [5, 4],
  [4, 2],
  [5, 3],
  [3, 2],
  [2, 0],
  [1, 0],
] as const;

export type MarkStar = { x: number; y: number; radius: number };
export type MarkLine = { x1: number; y1: number; x2: number; y2: number };

const middleX = (Math.min(...LYRA.map((star) => star.x)) + Math.max(...LYRA.map((star) => star.x))) / 2;
const middleY = (Math.min(...LYRA.map((star) => star.y)) + Math.max(...LYRA.map((star) => star.y))) / 2;
const round = (value: number) => Math.round(value * 100) / 100;

/** Every star in LYRA order. Index 0 is Vega. */
export const MARK_STARS: MarkStar[] = LYRA.map((star, starIndex) => ({
  x: round((star.x - middleX) * SCALE),
  y: round((star.y - middleY) * SCALE),
  radius: STAR_RADII[starIndex],
}));

const gapAt = (starIndex: number) => (starIndex === 0 ? VEGA_LINE_GAP : MARK_STARS[starIndex].radius + LINE_GAP);

/** The figure lines in drawing order, each trimmed clear of both stars. */
export const MARK_LINES: MarkLine[] = FIGURE_STROKES.map(([fromIndex, toIndex]) => {
  const from = MARK_STARS[fromIndex];
  const to = MARK_STARS[toIndex];
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const unitX = (to.x - from.x) / length;
  const unitY = (to.y - from.y) / length;
  return {
    x1: round(from.x + unitX * gapAt(fromIndex)),
    y1: round(from.y + unitY * gapAt(fromIndex)),
    x2: round(to.x - unitX * gapAt(toIndex)),
    y2: round(to.y - unitY * gapAt(toIndex)),
  };
});
