/**
 * The one bounding rule of every page graphic: the figure fits inside the graphic box with this
 * inset on every side. The figure is the path, the stars, the rings, and the articles, with the full
 * reach of each mark. A scene must keep that reach inside the inset, as the products scene does with SLOT_REACH.
 * Only the faint mesh, the star field, and the grid may run into the edge fade.
 * The inset is larger than the 24px edge fade, so the fade is a soft finish and never a crop.
 */
export const FIGURE_INSET = 32;

/**
 * Publish the left bound of the figure, in CSS pixels from the left edge of the graphic box.
 * A page module calls it once for each layout, so a test can read where the figure starts.
 * `origin` is the left edge of the drawing area inside the box, which is 0 unless the figure shares the box.
 */
export function reportFigureLeft(container: HTMLElement, origin = 0): void {
  container.dataset.figureLeft = String(origin + FIGURE_INSET);
}
