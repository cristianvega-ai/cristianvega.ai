/**
 * Shared page graphics exports.
 * Read [the page graphics guide](./README.md) for scene setup and ownership.
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
