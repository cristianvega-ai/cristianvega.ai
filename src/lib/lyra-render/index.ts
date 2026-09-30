/**
 * Page graphics: one canvas picture for each page, drawn in the language of the
 * homepage Orbit globe (sky light, neurons, comets, the Lyra figure).
 *
 * Modules
 *   math.ts     clamp, easeOutCubic, TAU (from ../motion/easing.ts), smooth, lerp, unit
 *   palette.ts  readPalette(), getGlow(): the site colours and a cached glow sprite
 *   lyra.ts     layoutLyra(w, h): the Lyra figure fitted into a box with one uniform scale, capped at
 *               LYRA_MAX_SIZE, so its proportions are the same on every canvas (data: ../lyra/constellation.ts)
 *   labels.ts   placeLabel(): the side of a node (right, left, above, below) that no edge crosses, inside
 *               labelBounds(). Use it for every label. drawLabel() adds an ink halo in the ground colour.
 *   inset.ts    FIGURE_INSET (32px), figureRect(): the one bounding rule. The figure (path, stars, rings, posts)
 *               fits inside the box with this inset. Only the faint mesh, star field, and grid may run into the edge fade.
 *   mesh.ts     makeMesh(), drawMesh(): the sparse neural mesh behind a graphic. makeGridLayer(): the site grid.
 *   clock.ts    DURATION (2300 ms), entranceProgress(), stagger()
 *   marks.ts    drawNode, drawEdge, drawCurve, makeRoute, drawComet, drawLabel, drawVegaBloom,
 *               makeStarField, drawStarField. A curve point comes from cubicPoint() in ../motion/easing.ts.
 *   mount.ts    mountCanvas(container, { draw, onResize?, attach?, duration?, dprCap? })
 *   scroll.ts   createScrollReader(container): a smoothed scroll share for a graphic that follows the reader
 *   pages/      one file for each page, and the registry in pages/index.ts
 *
 * How to add a page graphic
 *   1. Write `pages/<page>.ts`. Export `mount<Page>(container: HTMLElement)` that returns
 *      `mountCanvas(container, { draw, onResize })`. Build the layout in `onResize` from
 *      `state.w` and `state.h`. Draw from `state.progress` (the entrance, 0 to 1). Do not copy a
 *      CSS breakpoint: read the box, or read `getComputedStyle(container)` once in `onResize`.
 *      Place each label with `placeLabel` and `labelBounds`, and draw the neural mesh first with `drawMesh`.
 *   2. Draw the finished picture when `state.reduced` is true. Show no drift and no marker.
 *   3. Return true from `draw` only while the picture still moves after the entrance
 *      (a drift, or a scroll that settles). Return nothing at rest, and the loop stops.
 *   4. Add one line to the registry in `pages/index.ts`:
 *      `<page>: () => import("./<page>.ts").then((module) => module.mount<Page>)`.
 *      Add the page name to the `Page` type of `src/components/PageGraphic.astro`.
 *   5. Put `<PageGraphic page="<page>" />` as the first child of `<main>`.
 *      The component places the box: fixed beside the reading column from 1100px, and a band
 *      above the title below that. If the page needs another placement, add a modifier class
 *      to the component and its rules in `src/styles/global.css`.
 *   6. Add a browser spec. Copy the checks in `tests/e2e/about.spec.mjs`: aria-hidden, no text
 *      overlap, motion state, off-screen pause, and pagehide.
 *
 * What `mountCanvas` guarantees, so a page module does not repeat it
 *   - `data-ready="true"` after the first frame, and `data-motion-state` of "playing" or "still".
 *   - A device pixel ratio cap of 2, and a rebuild on every box change (ResizeObserver).
 *   - No frames while the box is off-screen or the tab is hidden (IntersectionObserver, visibilitychange).
 *   - Reduced motion: the finished picture on the first frame, no frames. A live change applies.
 *   - Teardown on pagehide, and a new setup on a persisted pageshow.
 *   - A frame allocates nothing and measures nothing. Keep that rule in `draw`: build arrays and
 *     strings in `onResize`, and read the DOM there only.
 */
export { DURATION, entranceProgress, stagger } from "./clock.ts";
export { layoutLyra, LYRA_MAX_SIZE, type LyraLayoutOptions, type LyraPoint } from "./lyra.ts";
export {
  around,
  ellipseSegments,
  labelBounds,
  labelWidth,
  placeLabel,
  polylineSegments,
  rectsOverlap,
  segmentHitsRect,
  type LabelAlign,
  type LabelSide,
  type PlaceOptions,
  type PlacedLabel,
  type Rect,
  type Segment,
} from "./labels.ts";
export { FIGURE_INSET, figureRect } from "./inset.ts";
export { drawMesh, makeGridLayer, makeMesh, type Mesh } from "./mesh.ts";
export {
  drawComet,
  drawCurve,
  drawEdge,
  drawLabel,
  drawNode,
  drawStarField,
  drawVegaBloom,
  makeRoute,
  makeStarField,
  type FieldStar,
  type Route,
} from "./marks.ts";
export { clamp, easeOutCubic, lerp, smooth, TAU, unit } from "./math.ts";
export { mountCanvas, type CanvasHandle, type FrameState, type MountOptions } from "./mount.ts";
export { getGlow, readPalette, type Palette } from "./palette.ts";
export { createScrollReader, type ScrollReader } from "./scroll.ts";
