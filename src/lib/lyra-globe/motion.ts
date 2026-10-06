import { clamp, easeOutCubic, FULL_TURN_RADIANS, type Point } from "../motion/easing.ts";
import { GLOBE_POLICY, mountCanvasController, type FrameState } from "../motion/canvas-controller.ts";
import type { Palette } from "../lyra-render/palette.ts";
import { entranceProgress } from "../lyra-render/clock.ts";
import { buildGlobe, EDGE_SPAN, GLOBE_HEIGHT, GLOBE_WIDTH, NODE_SPAN, type Globe, type GlobeRoute } from "./model.ts";

/** How far behind its head a comet leaves light, in grid units, and in how many soft slices. */
const TAIL_LENGTH = 120;
const TAIL_SLICES = 16;
const COMET_GLOW = 26;
const VEGA_GLOW = 60;

// Scratch points, so a frame allocates nothing.
const head: Point = { x: 0, y: 0 };
const tailStart: Point = { x: 0, y: 0 };
const tailEnd: Point = { x: 0, y: 0 };

/** Ease from 0 to 1 with no jump at either end. */
function smooth(value: number): number {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
}

/** The point at a distance along a route, written into `out`. */
function pointAt(route: GlobeRoute, distance: number, out: Point): Point {
  const { points, lengths } = route;
  let i = 1;
  while (i < points.length - 1 && lengths[i] < distance) i++;
  const span = lengths[i] - lengths[i - 1];
  const share = span > 0 ? clamp((distance - lengths[i - 1]) / span) : 1;
  out.x = points[i - 1].x + (points[i].x - points[i - 1].x) * share;
  out.y = points[i - 1].y + (points[i].y - points[i - 1].y) * share;
  return out;
}

// The globe at one point of the entrance, mark for mark as the build-time SVG
// draws it: field stars, rings, every edge, and every neuron with its halo.
// The labels are text over the box and are not drawn here. At progress 1 every
// mark is whole, so the last frame is the finished picture. Before that the
// mesh draws from the far side to the near side, the neurons appear in turn,
// and the figure draws toward Vega. Each mark eases in, so nothing flashes.
function paintGlobe(ctx: CanvasRenderingContext2D, globe: Globe, palette: Palette, glow: HTMLCanvasElement, progress: number) {
  ctx.lineCap = "round";
  ctx.fillStyle = palette.meta;
  const starsIn = smooth(progress / 0.5);
  for (let i = 0; i < globe.stars.length; i++) {
    const star = globe.stars[i];
    ctx.globalAlpha = star.alpha * starsIn;
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.radius, 0, FULL_TURN_RADIANS);
    ctx.fill();
  }
  ctx.strokeStyle = palette.sky;
  ctx.lineWidth = 0.7;
  const ringsIn = smooth((progress - 0.04) / 0.5);
  for (let i = 0; i < globe.rings.length; i++) {
    const ring = globe.rings[i];
    const grow = 0.94 + 0.06 * easeOutCubic(ringsIn);
    ctx.globalAlpha = ring.alpha * ringsIn;
    ctx.beginPath();
    ctx.ellipse(ring.x, ring.y, ring.rx * grow, ring.ry * grow, ring.rotate, 0, FULL_TURN_RADIANS);
    ctx.stroke();
  }
  for (let i = 0; i < globe.edges.length; i++) {
    const edge = globe.edges[i];
    const t = clamp((progress - edge.start) / EDGE_SPAN);
    if (t <= 0) continue;
    const from = edge.from;
    const to = edge.from === edge.a ? edge.b : edge.a;
    const grow = easeOutCubic(t);
    ctx.strokeStyle = edge.hot ? palette.sky : palette.meta;
    ctx.globalAlpha = (edge.hot ? 0.7 : edge.alpha) * smooth(t * 2);
    ctx.lineWidth = edge.hot ? 1.1 : 0.65;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(from.x + (to.x - from.x) * grow, from.y + (to.y - from.y) * grow);
    ctx.stroke();
  }
  for (let i = 0; i < globe.nodes.length; i++) {
    const node = globe.nodes[i];
    const t = clamp((progress - node.start) / NODE_SPAN);
    if (t <= 0) continue;
    const grow = easeOutCubic(t);
    if (node.hot) {
      const reach = (node.vega ? 18 : 8) * grow;
      ctx.globalAlpha = grow;
      ctx.drawImage(glow, node.x - reach, node.y - reach, reach * 2, reach * 2);
    }
    ctx.globalAlpha = node.alpha * smooth(t * 1.5);
    ctx.fillStyle = palette.text;
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.radius * (0.4 + 0.6 * grow), 0, FULL_TURN_RADIANS);
    ctx.fill();
    if (node.vega) {
      ctx.globalAlpha = 0.6 * grow;
      ctx.strokeStyle = palette.sky;
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.arc(node.x, node.y, 10 * (0.6 + 0.4 * grow), 0, FULL_TURN_RADIANS);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

/** Put the build-time SVG in the box. It is the picture when the canvas cannot draw. Returns its removal. */
function showFallback(root: HTMLElement): () => void {
  const template = root.querySelector("template");
  const svg = template?.content.firstElementChild?.cloneNode(true) as Element | undefined;
  if (!template || !svg) return () => {};
  root.prepend(svg);
  root.dataset.fallback = "true";
  return () => {
    svg.remove();
    root.removeAttribute("data-fallback");
  };
}

/**
 * Draw the Lyra globe on its canvas, with a short entrance. The build-time SVG
 * is not on the page while the canvas works. It sits in a noscript for visitors
 * without JavaScript, and this function puts a copy in the box when canvas is
 * missing or setup fails. Returns the cleanup function.
 */
export function setupLyraGlobe(root = document.querySelector<HTMLElement>("[data-lyra-globe]")): () => void {
  if (!root) return () => {};
  try {
    return drawGlobe(root) ?? showFallback(root);
  } catch {
    return showFallback(root);
  }
}

/** Draw the globe scene. Restart its entrance after a restored page. */
function drawGlobe(root: HTMLElement): (() => void) | undefined {
  let globe: Globe | undefined;
  let vega: Globe["hotNodes"][number] | undefined;
  let scale = 1;
  let removeFallback: (() => void) | undefined;
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
    scale = Math.round(state.w * state.ratio) / GLOBE_WIDTH;
    globe = globe ?? buildGlobe();
    vega = globe.hotNodes.find((node) => node.vega);
  }

  function draw(ctx: CanvasRenderingContext2D, state: FrameState) {
    if (!globe) return;
    if (state.still) {
      for (let i = 0; i < labelAnimations.length; i++) labelAnimations[i].animation.finish();
      // Restore the model opacity after the entrance.
      detachLabels();
    }
    for (let i = 0; i < labelAnimations.length; i++) {
      const binding = labelAnimations[i];
      binding.animation.currentTime = clamp((state.progress - binding.start) / binding.span);
    }
    const ease = easeOutCubic(state.progress);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.save();
    // Settle the globe on its finished pose.
    ctx.translate(GLOBE_WIDTH / 2, GLOBE_HEIGHT / 2);
    ctx.rotate(globe.rotation * (1 - ease));
    ctx.scale(0.985 + 0.015 * ease, 0.985 + 0.015 * ease);
    ctx.translate(-GLOBE_WIDTH / 2, -GLOBE_HEIGHT / 2);
    paintGlobe(ctx, globe, state.palette, state.glow, state.progress);
    if (!state.still) drawSignals(ctx, state.progress, state.palette, state.glow);
    ctx.restore();
  }

  /** Draw comets and the temporary Vega bloom. */
  function drawSignals(ctx: CanvasRenderingContext2D, progress: number, palette: Palette, glow: HTMLCanvasElement) {
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.strokeStyle = palette.sky;
    for (let i = 0; i < globe!.routes.length; i++) drawComet(ctx, globe!.routes[i], progress, palette, glow);
    const bloom = smooth((progress - 0.62) / 0.22) * (1 - smooth((progress - 0.84) / 0.16));
    if (vega && bloom > 0) {
      ctx.globalAlpha = 0.5 * bloom;
      ctx.drawImage(glow, vega.x - VEGA_GLOW / 2, vega.y - VEGA_GLOW / 2, VEGA_GLOW, VEGA_GLOW);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  function drawComet(ctx: CanvasRenderingContext2D, route: GlobeRoute, progress: number, palette: Palette, glow: HTMLCanvasElement) {
    const travel = (progress - route.start) / route.span;
    if (travel <= 0 || travel >= 1) return;
    // Slow each comet as it reaches the star.
    const distance = route.length * (1 - (1 - travel) ** 1.6);
    const strength = smooth(travel / 0.16) * (1 - smooth((travel - 0.86) / 0.14));
    pointAt(route, distance, head);
    tailStart.x = head.x;
    tailStart.y = head.y;
    for (let slice = 1; slice <= TAIL_SLICES; slice++) {
      const behind = distance - (slice / TAIL_SLICES) * TAIL_LENGTH;
      if (behind < 0) break;
      const fade = 1 - slice / TAIL_SLICES;
      pointAt(route, behind, tailEnd);
      ctx.globalAlpha = 0.75 * strength * fade * fade;
      ctx.lineWidth = 0.5 + 1.3 * fade;
      ctx.beginPath();
      ctx.moveTo(tailStart.x, tailStart.y);
      ctx.lineTo(tailEnd.x, tailEnd.y);
      ctx.stroke();
      tailStart.x = tailEnd.x;
      tailStart.y = tailEnd.y;
    }
    ctx.globalAlpha = 0.85 * strength;
    ctx.drawImage(glow, head.x - COMET_GLOW / 2, head.y - COMET_GLOW / 2, COMET_GLOW, COMET_GLOW);
    ctx.globalAlpha = strength;
    ctx.fillStyle = palette.text;
    ctx.beginPath();
    ctx.arc(head.x, head.y, 1.2, 0, FULL_TURN_RADIANS);
    ctx.fill();
  }

  const handle = mountCanvasController(root, { draw, onResize: resize, attach: attachLabels }, GLOBE_POLICY, () => {
    removeFallback = showFallback(root);
  });
  if (!handle) return undefined;
  return () => {
    handle.destroy();
    removeFallback?.();
  };
}
