import { clamp, easeOutCubic, FULL_TURN_RADIANS, type Point } from "../motion/easing.ts";
import { buildGlobe, EDGE_SPAN, GLOBE_HEIGHT, GLOBE_WIDTH, NODE_SPAN, type Globe, type GlobeRoute } from "./model.ts";

const DURATION_MS = 2300;
const MAX_PIXEL_RATIO = 1.75;
const GLOW_SIZE = 96;
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

interface Palette {
  sky: string;
  meta: string;
  text: string;
  /** Sky as "r, g, b", for the glow gradient stops. */
  skyChannels: string;
}

function readPalette(root: HTMLElement): Palette {
  const style = getComputedStyle(root);
  const sky = style.getPropertyValue("--sky").trim();
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(sky.slice(i, i + 2), 16));
  return {
    sky,
    meta: style.getPropertyValue("--mast-meta").trim(),
    text: style.getPropertyValue("--mast-text").trim(),
    skyChannels: `${r}, ${g}, ${b}`,
  };
}

// The same halo the SVG paints: sky at 45% in the centre, clear at the edge.
function makeGlow(palette: Palette): HTMLCanvasElement | null {
  const glow = document.createElement("canvas");
  glow.width = glow.height = GLOW_SIZE;
  const ctx = glow.getContext("2d");
  if (!ctx) return null;
  const half = GLOW_SIZE / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, `rgba(${palette.skyChannels}, 0.45)`);
  gradient.addColorStop(1, `rgba(${palette.skyChannels}, 0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, GLOW_SIZE, GLOW_SIZE);
  return glow;
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

/** The canvas globe. Returns nothing when the browser cannot draw it. */
function drawGlobe(root: HTMLElement): (() => void) | undefined {
  const canvas = root.querySelector("canvas");
  const ctx = canvas?.getContext("2d");
  const palette = readPalette(root);
  const glow = makeGlow(palette);
  if (!canvas || !ctx || !glow || !("ResizeObserver" in window) || !("IntersectionObserver" in window)) return undefined;

  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let elapsed = reduced.matches ? DURATION_MS : 0;
  let globe: Globe | undefined;
  // Canvas pixels per globe unit. The SVG scales its viewBox the same way.
  let scale = 1;
  let frame = 0;
  let previous = 0;
  let visible = false;
  let disposed = false;

  function draw() {
    if (!globe) return;
    // The clock runs a little fast at the start, so the first marks show at once.
    // It still starts at 0 and ends at 1, so the last frame is the finished picture.
    const progress = 1 - (1 - elapsed / DURATION_MS) ** 1.3;
    const ease = easeOutCubic(progress);
    ctx!.setTransform(1, 0, 0, 1, 0, 0);
    ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
    ctx!.setTransform(scale, 0, 0, scale, 0, 0);
    ctx!.save();
    // A small settle. It starts a few percent from the finished pose and ends on it.
    ctx!.translate(GLOBE_WIDTH / 2, GLOBE_HEIGHT / 2);
    ctx!.rotate(globe.rotation * (1 - ease));
    ctx!.scale(0.985 + 0.015 * ease, 0.985 + 0.015 * ease);
    ctx!.translate(-GLOBE_WIDTH / 2, -GLOBE_HEIGHT / 2);
    paintGlobe(ctx!, globe, palette, glow!, progress);
    if (elapsed < DURATION_MS) drawSignals(progress);
    ctx!.restore();
    ctx!.globalAlpha = 1;
    if (elapsed === DURATION_MS) root.dataset.motionState = "still";
  }

  // Comets run their routes to Vega with a soft tail, drawn with added light.
  // Vega blooms as they arrive, and the bloom is gone when the entrance ends.
  function drawSignals(progress: number) {
    ctx!.globalCompositeOperation = "lighter";
    ctx!.lineCap = "round";
    ctx!.strokeStyle = palette.sky;
    for (let i = 0; i < globe!.routes.length; i++) drawComet(globe!.routes[i], progress);
    const vega = globe!.hotNodes.find((node) => node.vega);
    const bloom = smooth((progress - 0.62) / 0.22) * (1 - smooth((progress - 0.84) / 0.16));
    if (vega && bloom > 0) {
      ctx!.globalAlpha = 0.5 * bloom;
      ctx!.drawImage(glow!, vega.x - VEGA_GLOW / 2, vega.y - VEGA_GLOW / 2, VEGA_GLOW, VEGA_GLOW);
    }
    ctx!.globalAlpha = 1;
    ctx!.globalCompositeOperation = "source-over";
  }

  function drawComet(route: GlobeRoute, progress: number) {
    const travel = (progress - route.start) / route.span;
    if (travel <= 0 || travel >= 1) return;
    // The comet eases into its run and slows as it meets the star.
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
      ctx!.globalAlpha = 0.75 * strength * fade * fade;
      ctx!.lineWidth = 0.5 + 1.3 * fade;
      ctx!.beginPath();
      ctx!.moveTo(tailStart.x, tailStart.y);
      ctx!.lineTo(tailEnd.x, tailEnd.y);
      ctx!.stroke();
      tailStart.x = tailEnd.x;
      tailStart.y = tailEnd.y;
    }
    ctx!.globalAlpha = 0.85 * strength;
    ctx!.drawImage(glow!, head.x - COMET_GLOW / 2, head.y - COMET_GLOW / 2, COMET_GLOW, COMET_GLOW);
    ctx!.globalAlpha = strength;
    ctx!.fillStyle = palette.text;
    ctx!.beginPath();
    ctx!.arc(head.x, head.y, 1.2, 0, FULL_TURN_RADIANS);
    ctx!.fill();
  }

  function tick(time: number) {
    frame = 0;
    if (previous) elapsed = Math.min(DURATION_MS, elapsed + time - previous);
    previous = time;
    draw();
    resume();
  }

  function resume() {
    if (frame || !globe || !visible || document.hidden || disposed || elapsed >= DURATION_MS) return;
    if (!previous) root.dataset.motionState = "playing";
    frame = requestAnimationFrame(tick);
  }

  function pause() {
    cancelAnimationFrame(frame);
    frame = 0;
    previous = 0;
  }

  function resize() {
    if (disposed) return;
    const box = canvas!.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const ratio = Math.min(devicePixelRatio || 1, MAX_PIXEL_RATIO);
    canvas!.width = Math.round(box.width * ratio);
    canvas!.height = Math.round(box.height * ratio);
    // The model keeps the SVG's own size, so the canvas and the SVG share one
    // projection and one label grid at every box size.
    scale = canvas!.width / GLOBE_WIDTH;
    globe = globe ?? buildGlobe();
    draw();
    // Show the canvas once it holds its first frame.
    root.dataset.ready = "true";
    if (elapsed >= DURATION_MS) root!.dataset.motionState = "still";
    resume();
  }

  const size = new ResizeObserver(resize);
  size.observe(canvas);
  const intersection = new IntersectionObserver((entries) => {
    visible = entries[entries.length - 1].isIntersecting;
    if (visible) resume();
    else pause();
  });
  intersection.observe(root);
  const onVisibility = () => (document.hidden ? pause() : resume());
  const onPreference = () => {
    if (!reduced.matches) return;
    pause();
    elapsed = DURATION_MS;
    draw();
    root.dataset.motionState = "still";
  };
  document.addEventListener("visibilitychange", onVisibility);
  reduced.addEventListener("change", onPreference);
  return () => {
    disposed = true;
    pause();
    size.disconnect();
    intersection.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
    reduced.removeEventListener("change", onPreference);
    glow.width = glow.height = 0;
    root.removeAttribute("data-ready");
    root.removeAttribute("data-motion-state");
  };
}
