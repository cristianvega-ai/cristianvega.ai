import type { Rect } from "./labels.ts";

/**
 * The one bounding rule of every page graphic: the figure fits inside the graphic box with this
 * inset on every side. The figure is the path, the stars, the rings, and the posts.
 * Only the faint mesh, the star field, and the grid may run into the edge fade.
 * The inset is larger than the 24px edge fade, so the fade is a soft finish and never a crop.
 */
export const FIGURE_INSET = 32;

/** The figure box uses the supplied canvas width and height. */
export function figureRect(width: number, height: number): Rect {
  return { x0: FIGURE_INSET, y0: FIGURE_INSET, x1: width - FIGURE_INSET, y1: height - FIGURE_INSET };
}

/**
 * Publish the left bound of the figure, in CSS pixels from the left edge of the graphic box.
 * A page module calls it once for each layout, so a test can read where the figure starts.
 * `origin` is the left edge of the drawing area inside the box, which is 0 unless the figure shares the box.
 */
export function reportFigureLeft(container: HTMLElement, width: number, height: number, origin = 0): void {
  container.dataset.figureLeft = String(origin + figureRect(width, height).x0);
}
