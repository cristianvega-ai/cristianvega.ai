/**
 * Shared page graphics exports.
 * Read [the page graphics guide](./README.md) for scene setup and ownership.
 */
export { DURATION, entranceProgress, stagger } from "../motion/clock.ts";
export { layoutLyra, LYRA_MAXIMUM_SIZE, type LyraLayoutOptions, type LyraPoint } from "./lyra.ts";
export {
  around,
  ellipseSegments,
  labelBounds,
  placeLabel,
  polylineSegments,
  rectanglesOverlap,
  segmentIntersectsRectangle,
  type LabelAlign,
  type LabelSide,
  type PlaceOptions,
  type PlacedLabel,
  type Rectangle,
  type Segment,
} from "./labels.ts";
export { FIGURE_INSET, figureRectangle } from "./inset.ts";
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
export { clamp, easeOutCubic, interpolate, smooth, FULL_TURN_RADIANS, unit } from "./math.ts";
export { mountCanvas, type CanvasHandle, type FrameState, type MountOptions } from "./mount.ts";
export { getGlow, readPalette, type Palette } from "../motion/palette.ts";
export { createScrollReader, type ScrollReader } from "./scroll.ts";
