import { FIGURE_INSET } from "../inset.ts";
import { around, type PlacedLabel, type Rectangle } from "../labels.ts";
import { layoutLyra, lyraLinkSegments, placeStarNames, type LyraPoint } from "../lyra.ts";

// The layout of the 404 graphic, "Missing star". It has no DOM and no canvas, so a test can run it.

/** The star that is missing: delta. */
export const MISSING = 3;
/** The radius of the dashed ring that marks the gap. */
export const RING_RADIUS = 7;

interface MissingLayout {
  /** True for a band, where the figure turns a quarter turn. */
  wide: boolean;
  padding: number;
  rotation: number;
  showNames: boolean;
  /** How far a pulse spreads beyond the ring, in CSS pixels. */
  reach: number;
}

/** The layout choices for a box, from its measured size. */
export function missingLayout(width: number, height: number): MissingLayout {
  const wide = width > height * 1.6;
  return {
    wide,
    padding: wide ? FIGURE_INSET : 56,
    rotation: wide ? -Math.PI / 2 : 0,
    showNames: height > 300,
    reach: Math.min(58, Math.min(width, height) * 0.2),
  };
}

/**
 * Place the star names. Each takes the side of its star that no link crosses, clear of the other stars,
 * the empty ring, and the box edge. Vega always has its name, and the others only when the box is tall.
 */
function placeLabels(
  bounds: Rectangle,
  stars: readonly LyraPoint[],
  showNames: boolean,
  widthsInPixels: readonly number[],
  lineHeightInPixels: number,
): PlacedLabel[] {
  return placeStarNames(stars, {
    bounds,
    showNames,
    widthsInPixels,
    lineHeightInPixels,
    segments: lyraLinkSegments(stars),
    avoid: stars.map((star, starIndex) => around(star.x, star.y, starIndex === MISSING ? RING_RADIUS + 5 : 9)),
  });
}

/**
 * Fit the figure and place its names. When Vega finds no clear side, as in a narrow column, the figure
 * moves left by the room that its name needs, and the names are placed again.
 */
export function layoutMissing(
  width: number,
  height: number,
  layout: MissingLayout,
  bounds: Rectangle,
  widthsInPixels: readonly number[],
  lineHeightInPixels: number,
  outputStars: LyraPoint[] = [],
) {
  let stars = layoutLyra(width, height, { padding: layout.padding, rotation: layout.rotation, outputPoints: outputStars });
  let labels = placeLabels(bounds, stars, layout.showNames, widthsInPixels, lineHeightInPixels);
  if (labels[0] && !labels[0].clear) {
    stars = layoutLyra(width - widthsInPixels[0] - 24, height, { padding: layout.padding, rotation: layout.rotation, outputPoints: outputStars });
    labels = placeLabels(bounds, stars, layout.showNames, widthsInPixels, lineHeightInPixels);
  }
  return { stars, labels };
}
