import { FIGURE_INSET } from "./inset.ts";
import type { Rectangle } from "./labels.ts";

// The DOM read on the box of a page graphic. Call it on resize, not per frame.

/** The space that a label keeps from the canvas edge. It is the figure inset, so a label follows the one bounding rule. */
const EDGE_INSET = FIGURE_INSET;
/** The space that a label keeps from the viewport edge. */
const VIEWPORT_INSET = 32;

/**
 * The area for labels, in canvas pixels: inside the edge fade, and at least `VIEWPORT_INSET` from the
 * viewport edge. `originX` is the shift of the drawing origin in the canvas.
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
