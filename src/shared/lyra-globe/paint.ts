import { stagger } from "../motion/clock.ts";
import { drawComet } from "../motion/comets.ts";
import { easeOutCubic, smooth } from "../motion/easing.ts";
import { FULL_TURN_RADIANS } from "../motion/geometry.ts";
import type { FrameState } from "../motion/canvas-controller.ts";
import { drawEdge, drawNode, drawVegaBloom, entranceBloom } from "../motion/marks.ts";
import type { Palette } from "../motion/palette.ts";
import { drawStarField } from "../motion/star-field.ts";
import { EDGE_SPAN, GLOBE_HEIGHT, GLOBE_WIDTH, NODE_SPAN, type Globe } from "./model.ts";

/** How far behind its head a comet leaves light, in grid units. */
const TAIL_LENGTH = 120;

type GlobeNode = Globe["hotNodes"][number];

/**
 * Draw one frame of the globe in grid units. `scale` maps the grid to canvas pixels.
 * The globe turns and grows a little during the entrance, and settles on its finished pose.
 */
export function paintGlobeFrame(
  drawingContext: CanvasRenderingContext2D,
  globe: Globe,
  vega: GlobeNode | undefined,
  scale: number,
  state: FrameState,
): void {
  const entranceGrowth = easeOutCubic(state.progress);
  drawingContext.setTransform(scale, 0, 0, scale, 0, 0);
  drawingContext.save();
  drawingContext.translate(GLOBE_WIDTH / 2, GLOBE_HEIGHT / 2);
  drawingContext.rotate(globe.rotation * (1 - entranceGrowth));
  drawingContext.scale(0.985 + 0.015 * entranceGrowth, 0.985 + 0.015 * entranceGrowth);
  drawingContext.translate(-GLOBE_WIDTH / 2, -GLOBE_HEIGHT / 2);
  paintGlobe(drawingContext, globe, state.palette, state.glow, state.progress);
  if (!state.entranceComplete) paintSignals(drawingContext, globe, vega, state.progress, state.palette, state.glow);
  drawingContext.restore();
}

// The globe at one point of the entrance, mark for mark as the build-time SVG
// draws it: field stars, rings, every edge, and every neuron with its halo.
// The labels are text over the box and are not drawn here. At progress 1 every
// mark is whole, so the last frame is the finished picture. Before that the
// mesh draws from the far side to the near side, the neurons appear in turn,
// and the figure draws toward Vega. Each mark eases in, so nothing flashes.
function paintGlobe(
  drawingContext: CanvasRenderingContext2D,
  globe: Globe,
  palette: Palette,
  glow: HTMLCanvasElement,
  progress: number,
) {
  drawingContext.lineCap = "round";
  drawStarField(drawingContext, palette, globe.stars, progress);
  paintRings(drawingContext, globe, palette, progress);
  for (let i = 0; i < globe.edges.length; i++) {
    const edge = globe.edges[i];
    const to = edge.from === edge.a ? edge.b : edge.a;
    drawEdge(drawingContext, palette, edge.from.x, edge.from.y, to.x, to.y, stagger(progress, edge.start, EDGE_SPAN), edge.hot, edge.alpha);
  }
  for (let i = 0; i < globe.nodes.length; i++) {
    const node = globe.nodes[i];
    drawNode(drawingContext, palette, glow, node.x, node.y, node.radius, stagger(progress, node.start, NODE_SPAN), node.hot, node.alpha, node.vega);
  }
}

/** The orbit rings. They fade in and grow to their full size. */
function paintRings(drawingContext: CanvasRenderingContext2D, globe: Globe, palette: Palette, progress: number) {
  drawingContext.strokeStyle = palette.sky;
  drawingContext.lineWidth = 0.7;
  const ringsIn = smooth((progress - 0.04) / 0.5);
  for (let i = 0; i < globe.rings.length; i++) {
    const ring = globe.rings[i];
    const grow = 0.94 + 0.06 * easeOutCubic(ringsIn);
    drawingContext.globalAlpha = ring.alpha * ringsIn;
    drawingContext.beginPath();
    drawingContext.ellipse(ring.x, ring.y, ring.rx * grow, ring.ry * grow, ring.rotate, 0, FULL_TURN_RADIANS);
    drawingContext.stroke();
  }
  drawingContext.globalAlpha = 1;
}

/** Draw the comets and the temporary Vega bloom of the entrance. */
function paintSignals(
  drawingContext: CanvasRenderingContext2D,
  globe: Globe,
  vega: GlobeNode | undefined,
  progress: number,
  palette: Palette,
  glow: HTMLCanvasElement,
) {
  for (let i = 0; i < globe.routes.length; i++) {
    const route = globe.routes[i];
    drawComet(drawingContext, palette, glow, route, stagger(progress, route.start, route.span), TAIL_LENGTH);
  }
  if (vega) drawVegaBloom(drawingContext, glow, vega.x, vega.y, entranceBloom(progress));
}
