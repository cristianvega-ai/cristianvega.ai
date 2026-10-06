/**
 * Page graphics: decorative canvas scenes for About, Writing, Products, and 404.
 * Use the homepage globe's visual language: sky light, neurons, comets, and Lyra.
 *
 * Inputs and ownership
 *   PageGraphic.astro uses a Props union for supported scenes.
 *   Products must pass productCount and currentProductIndex.
 *   Pass the visible product count on both product routes.
 *   Pass null for currentProductIndex on the product index.
 *   Pass the visible product's list index on detail pages.
 *   Writing reads hooks inside the closest [data-writing-page].
 *   Use [data-writing-list], [data-writing-entry-id], and [data-writing-label].
 *   Keep page bindings separate from geometry helpers and drawing.
 *
 * Lifecycle and clocks
 *   ../motion/canvas-controller.ts owns active clocks, observers, frames, listeners, and cleanup.
 *   Scenes own layout, drawing, and interaction listeners.
 *   Active time excludes hidden tabs and periods outside the viewport.
 *   Page scenes cap frame intervals at 64 milliseconds and device pixel ratios at 2.
 *   Page scenes preserve their clocks across restored pages.
 *   The globe uses full frame intervals and caps device pixel ratios at 1.75.
 *   The globe restarts its entrance after a restored page.
 *   state.entranceComplete reports completion of the configured controller duration.
 *   data-motion-state stays "playing" while the scene requests more motion.
 *
 * Scene timing and reduced motion
 *   Visual entrances take about 2.3 active seconds.
 *   The globe completes its entrance and rests.
 *   About follows scroll while its graphic stays fixed.
 *   About bands and pages without scrolling rest at Vega.
 *   Reduced motion keeps About's static reader marker and updates scroll changes without easing.
 *   The marker fades into Vega at the path's end.
 *   Writing answers pointer and keyboard focus, then rests after the glow fades.
 *   Reduced motion updates Writing selection immediately, without comets.
 *   Products drift until 30 active seconds, then rest.
 *   The 404 scene uses a 30.5-second controller duration for four later search pulses.
 *   It draws its visual entrance from state.elapsed.
 *   Reduced motion completes entrances immediately and runs no continuous frames, drift, comets, or search pulses.
 *
 * Fonts and colors
 *   --font-mono supplies the label font family.
 *   label-font.ts caches measured widths in CSS pixels.
 *   Font completion, failure, and resizing rebuild these measurements.
 *   placeLabel() uses measured widths.
 *   drawLabel() uses labelFont.canvasFont.
 *   Use #RRGGBB for --sky.
 *   readPalette() accepts six hexadecimal digits in either letter case.
 *   Unsupported formats use #38BDF8 for sky marks and glow gradients.
 *   Use palette.skyChannels when a gradient needs RGB channels.
 *
 * Globe presentation
 *   ../lyra-globe/model.ts owns globe geometry and label anchors.
 *   ../lyra-globe/projection.ts generates a versioned external stylesheet from model measurements.
 *   ../../styles/home.css owns responsive placement.
 *   Globe labels use canvas entrance progress and pause with the drawing.
 *
 * Modules
 *   math.ts: easing, interpolation, and stable numeric samples.
 *   palette.ts: validated site colors and a cached glow sprite.
 *   lyra.ts: layoutLyra(width, height) preserves proportions and caps the figure at LYRA_MAX_SIZE.
 *   label-font.ts: measured label widths and the canvas font.
 *   labels.ts: placeLabel() uses measured widths and labelBounds().
 *   inset.ts: FIGURE_INSET and figureRect() keep the figure inside the edge fade.
 *   mesh.ts: sparse neural meshes and cached site grids.
 *   clock.ts: DURATION, entranceProgress(), and stagger().
 *   marks.ts: nodes, edges, curves, routes, comets, labels, blooms, and star fields.
 *   mount.ts: page policies, scene mounting, and font refreshes.
 *   scroll.ts: measured page geometry and a smoothed reader position.
 *   scenes/: page drawings and the lazy registry in scenes/index.ts.
 *
 * How to add a page graphic
 *   1. Write scenes/<scene>.ts.
 *      Export mount<Scene>(container: HTMLElement).
 *      Return mountCanvas(container, { draw, onResize }).
 *      Build layout in onResize from state.width and state.height.
 *      Use measured boxes for scene layout.
 *      Keep CSS breakpoints in styles.
 *      Draw from state.progress for the default entrance.
 *      Use state.activeTime for motion that continues after the entrance.
 *   2. Measure labels with state.labelFont.widthCssPx(text) during layout.
 *      Pass each width to placeLabel().
 *      Use labelBounds() for each label.
 *      Pass state.labelFont.canvasFont to drawLabel().
 *      Draw the neural mesh first with drawMesh().
 *   3. Draw the completed entrance when state.reduced is true.
 *      Preserve static interaction markers.
 *      Return true while interaction or drift needs more frames.
 *      Return false or nothing at rest.
 *      Call handle.wake() when an idle scene needs animated interaction updates.
 *      Call handle.redraw() for immediate reduced-motion updates.
 *   4. Add a lazy import to scenes/index.ts:
 *      <scene>: () => import("./<scene>.ts").then((module) => module.mount<Scene>).
 *      Add its name and required inputs to the Props union in src/components/PageGraphic.astro.
 *   5. Put <PageGraphic page="<scene>" /> first inside <main>.
 *      Pass required props through this component.
 *      Use dedicated page hooks for list bindings.
 *      global.css fixes the box beside the reading column from 1100px.
 *      Narrower layouts use the shared responsive --band-height token.
 *      Writing uses 1.19 times that height through blog.css.
 *   6. Read tests/AGENTS.md before adding browser checks.
 *      Keep scene assertions in the owning page suite.
 *      Use tests/e2e/page-graphics.spec.mjs for shared entrance, pause, reduced-motion, and restoration checks.
 *      Use tests/e2e/canvas-controller.spec.mjs for controller policies and cleanup.
 *      Share frame stepping and pixel helpers through tests/e2e/fixtures.mjs.
 *
 * mountCanvas guarantees
 *   - data-ready="true" after the first frame.
 *   - data-motion-state="playing" or "still" reports whether motion continues.
 *   - ResizeObserver rebuilds changed canvas boxes.
 *   - Font completion or failure refreshes label measurements and layout.
 *   - IntersectionObserver and visibilitychange pause frames outside the viewport or in hidden tabs.
 *   - Reduced motion draws the completed entrance immediately, including live preference changes.
 *   - pagehide tears down observers and scene listeners.
 *   - A persisted pageshow sets up the scene again.
 *
 * Keep arrays, strings, label measurements, and geometry reads outside draw().
 * Build arrays and strings during layout.
 * Measure labels and geometry during layout.
 */
export { DURATION, entranceProgress, stagger } from "./clock.ts";
export { layoutLyra, LYRA_MAX_SIZE, type LyraLayoutOptions, type LyraPoint } from "./lyra.ts";
export {
  around,
  ellipseSegments,
  labelBounds,
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
