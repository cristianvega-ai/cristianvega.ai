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
 *   The products picture has MAX_SLOTS (8) slots. getProducts() fails the build when more products are published.
 *   scenes/product-slots.ts holds the slots and the build check. It has no DOM, so the build does not load the scene.
 *   Writing reads hooks inside the closest [data-writing-page].
 *   Use [data-writing-list], [data-writing-entry-id], and [data-writing-label].
 *   Keep page bindings separate from geometry helpers and drawing.
 *
 * Lifecycle and clocks
 *   ../motion/canvas-controller.ts owns active clocks, observers, frames, listeners, and cleanup.
 *   ../motion/ is the shared canvas layer. It does not import from page-graphics/ or lyra-globe/.
 *   Scenes own layout, drawing, and interaction listeners.
 *   Active time excludes hidden tabs and periods outside the viewport.
 *   Every canvas caps one frame interval at FRAME_INTERVAL_CAP_MS (64 milliseconds).
 *   A long frame then slows the motion for a moment instead of skipping part of it.
 *   Page scenes cap device pixel ratios at 2 and preserve their clocks across restored pages.
 *   The globe caps device pixel ratios at 1.75 and restarts its entrance after a restored page.
 *   Below the cap, each canvas bitmap has the device pixel size of its box, so the screen does not resample it.
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
 *   --font-mono supplies the label font family, and --fs-graphic-label supplies its size in px.
 *   A label line is LABEL_LINE_RATIO (1.2) times that size. labelFont.lineCssPx holds it.
 *   The globe labels in home.css read the same two tokens.
 *   label-font.ts caches measured widths in CSS pixels.
 *   Font completion, failure, and resizing rebuild these measurements.
 *   placeLabel() uses measured widths and the line of the label font.
 *   drawLabel() uses labelFont.canvasFont.
 *   The color tokens can use any CSS color that the browser parses, such as hex, rgb(), hsl(), or oklch().
 *   readPalette() resolves each one through a 1x1 canvas.
 *   A token that the canvas cannot parse logs a console warning, and the canvas draws its fallback color.
 *   Use palette.skyColor when a gradient needs channels. glowStops() keeps the alpha of the token.
 *
 * Globe presentation
 *   ../lyra-globe/model.ts owns globe geometry and label anchors.
 *   ../lyra-globe/projection.ts measures the model at build time and rounds the values. It owns the crop margins
 *   and the picture scale, and it writes a versioned stylesheet of --globe-* properties.
 *   The homepage links that stylesheet in the head slot of BaseLayout.astro. Its URL has an immutable cache rule.
 *   ../../styles/home.css owns responsive placement. Each --globe-* var() falls back to the current model value.
 *   The backdrop behind the sphere sits on the sphere centre.
 *   Globe labels use canvas entrance progress and pause with the drawing.
 *
 * Modules
 *   ../motion/clock.ts: DURATION, entranceProgress(), and stagger(). The globe uses the same clock.
 *   ../motion/palette.ts: validated site colors and a cached glow sprite. The globe uses the same palette.
 *   math.ts: easing, interpolation, and stable numeric samples.
 *   lyra.ts: layoutLyra(width, height) preserves proportions and caps the figure at LYRA_MAX_SIZE.
 *   label-font.ts: measured label widths and the canvas font.
 *   labels.ts: placeLabel() uses measured widths, the label line, and labelBounds().
 *   inset.ts: FIGURE_INSET and figureRect() keep the figure inside the edge fade.
 *     A scene must keep the reach of its marks inside the inset, not only the mark centres.
 *     The products scene keeps SLOT_REACH, the largest ring or halo round a slot.
 *   mesh.ts: sparse neural meshes and cached site grids.
 *   marks.ts: nodes, edges, curves, routes, comets, labels, blooms, and star fields.
 *   mount.ts: page policies, scene mounting, and font refreshes through handle.rebuild().
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
 *      Pass each width and state.labelFont.lineCssPx to placeLabel().
 *      Use labelBounds() for each label.
 *      Pass state.labelFont.canvasFont to drawLabel().
 *      Draw the neural mesh first with drawMesh().
 *   3. Draw the completed entrance when state.reduced is true.
 *      Preserve static interaction markers.
 *      Return true while interaction or drift needs more frames.
 *      Return false or nothing at rest.
 *      Call handle.wake() when an idle scene needs animated interaction updates.
 *      Call handle.redraw() for immediate reduced-motion updates.
 *      Call handle.rebuild() when layout inputs change outside a resize.
 *      It applies a pending motion preference before it draws.
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
 *   - Font completion or failure refreshes label measurements and layout through handle.rebuild().
 *   - handle.rebuild() applies a motion preference change before it draws, whatever the event order.
 *   - IntersectionObserver and visibilitychange pause frames outside the viewport or in hidden tabs.
 *   - Reduced motion draws the completed entrance immediately, including live preference changes.
 *   - pagehide tears down observers and scene listeners.
 *   - A persisted pageshow sets up the scene again.
 *
 * Keep arrays, strings, label measurements, and geometry reads outside draw().
 * Build arrays and strings during layout.
 * Measure labels and geometry during layout.
 */
export { DURATION, entranceProgress, stagger } from "../motion/clock.ts";
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
export { getGlow, readPalette, type Palette } from "../motion/palette.ts";
export { createScrollReader, type ScrollReader } from "./scroll.ts";
