import { clamp, easeOutCubic, FULL_TURN_RADIANS } from "../motion/easing.ts";
import { GLOBE_POLICY, mountCanvasController, type FrameState } from "../motion/canvas-controller.ts";
import type { Palette } from "../motion/palette.ts";
import { entranceProgress, stagger } from "../motion/clock.ts";
import { drawComet, drawEdge, drawNode, drawStarField, drawVegaBloom, entranceBloom } from "../page-graphics/marks.ts";
import { smooth } from "../page-graphics/math.ts";
import {
  buildGlobe,
  EDGE_SPAN,
  GLOBE_HEIGHT,
  GLOBE_WIDTH,
  NODE_SPAN,
  type Globe,
} from "./model.ts";

/** How far behind its head a comet leaves light, in grid units. */
const TAIL_LENGTH = 120;

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

/** Put the build-time SVG in the box. It is the picture when the canvas cannot draw. */
function showFallback(root: HTMLElement): void {
  const fallbackDrawing = root.querySelector("template")?.content.firstElementChild?.cloneNode(true) as Element | undefined;
  if (!fallbackDrawing) return;
  root.prepend(fallbackDrawing);
  root.dataset.fallback = "true";
}

/**
 * Draw the Lyra globe on its canvas, with a short entrance. The build-time SVG
 * is not on the page while the canvas works. It sits in a noscript for visitors
 * without JavaScript, and this function puts a copy in the box when canvas is
 * missing or setup fails.
 */
export function setupLyraGlobe(): void {
  const root = document.querySelector<HTMLElement>("[data-lyra-globe]");
  if (!root) return;
  try {
    if (!drawGlobe(root)) showFallback(root);
  } catch {
    showFallback(root);
  }
}

/** Draw the globe scene. Restart its entrance after a restored page. Return false when the canvas cannot draw. */
function drawGlobe(root: HTMLElement): boolean {
  let globe: Globe | undefined;
  let vega: Globe["hotNodes"][number] | undefined;
  let scale = 1;
  const labels = root.querySelectorAll<SVGTextElement>(".lyra-globe__label");
  const labelAnimations: { animation: Animation; start: number; span: number }[] = [];

  /** Bind paused animations once per entrance. The canvas clock sets their progress. */
  function attachLabels() {
    try {
      for (const label of labels) {
        const delay = label.classList.contains("lyra-globe__label--caption") ? 500 : 1400;
        const start = entranceProgress(delay);
        const animation = label.animate([{ opacity: 0 }, { opacity: label.getAttribute("opacity")! }], {
          duration: 1,
          easing: "ease-out",
          fill: "both",
        });
        labelAnimations.push({ animation, start, span: entranceProgress(delay + 700) - start });
        animation.pause();
        animation.currentTime = 0;
      }
    } catch (error) {
      detachLabels();
      throw error;
    }
    return detachLabels;
  }

  function detachLabels() {
    for (const binding of labelAnimations) binding.animation.cancel();
    labelAnimations.length = 0;
  }

  function resize(state: FrameState) {
    // Keep the canvas projection equal to the SVG projection.
    scale = Math.round(state.width * state.ratio) / GLOBE_WIDTH;
    globe = globe ?? buildGlobe();
    vega = globe.hotNodes.find((node) => node.vega);
  }

  function draw(drawingContext: CanvasRenderingContext2D, state: FrameState) {
    if (!globe) return;
    if (state.entranceComplete) {
      for (let i = 0; i < labelAnimations.length; i++) labelAnimations[i].animation.finish();
      // Restore the model opacity after the entrance.
      detachLabels();
    }
    for (let i = 0; i < labelAnimations.length; i++) {
      const binding = labelAnimations[i];
      binding.animation.currentTime = clamp((state.progress - binding.start) / binding.span);
    }
    const entranceGrowth = easeOutCubic(state.progress);
    drawingContext.setTransform(scale, 0, 0, scale, 0, 0);
    drawingContext.save();
    // Settle the globe on its finished pose.
    drawingContext.translate(GLOBE_WIDTH / 2, GLOBE_HEIGHT / 2);
    drawingContext.rotate(globe.rotation * (1 - entranceGrowth));
    drawingContext.scale(0.985 + 0.015 * entranceGrowth, 0.985 + 0.015 * entranceGrowth);
    drawingContext.translate(-GLOBE_WIDTH / 2, -GLOBE_HEIGHT / 2);
    paintGlobe(drawingContext, globe, state.palette, state.glow, state.progress);
    if (!state.entranceComplete) drawSignals(drawingContext, state.progress, state.palette, state.glow);
    drawingContext.restore();
  }

  /** Draw comets and the temporary Vega bloom. */
  function drawSignals(
    drawingContext: CanvasRenderingContext2D,
    progress: number,
    palette: Palette,
    glow: HTMLCanvasElement,
  ) {
    for (let i = 0; i < globe!.routes.length; i++) {
      const route = globe!.routes[i];
      drawComet(drawingContext, palette, glow, route, stagger(progress, route.start, route.span), TAIL_LENGTH);
    }
    if (vega) drawVegaBloom(drawingContext, glow, vega.x, vega.y, entranceBloom(progress));
  }

  const handle = mountCanvasController(root, { draw, onResize: resize, attach: attachLabels }, GLOBE_POLICY, () => showFallback(root));
  return handle !== null;
}
