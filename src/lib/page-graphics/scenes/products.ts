import type { Point } from "../../motion/easing.ts";
import { LYRA, LYRA_LINKS } from "../../lyra/constellation.ts";
import { stagger } from "../../motion/clock.ts";
import { around, ellipseSegments, labelBounds, placeLabel, type PlacedLabel, type Rect, type Segment } from "../labels.ts";
import { FIGURE_INSET, reportFigureLeft } from "../inset.ts";
import { LYRA_MAX_SIZE } from "../lyra.ts";
import { drawMesh, makeMesh, type Mesh } from "../mesh.ts";
import { drawComet, drawEdge, drawLabel, drawNode, drawStarField, drawVegaBloom, makeRoute, makeStarField, NODE_HALO, type FieldStar, type Route } from "../marks.ts";
import { easeOutCubic, smooth, TAU } from "../math.ts";
import { mountCanvas, type CanvasHandle, type FrameState } from "../mount.ts";
import { MAX_SLOTS, SLOT_OFFSET, SLOT_RING } from "./product-slots.ts";

// Constellation lattice: the products are ringed stars on elliptical orbits round Vega,
// and each one links to the Lyra figure. A published product is lit. Faint empty rings
// with no label show room to grow. Three small satellites drift on the orbits for
// a short time, then rest.

/** The orbit radii, as a share of the half box. */
const RINGS = [0.36, 0.66, 0.95] as const;
/** The picture always shows this many slots, and never more than MAX_SLOTS in product-slots.ts. */
export const MIN_SLOTS = 6;
/** A tall box gives the orbits at most this ratio of height to width, so a column does not stretch them. */
const MAX_ORBIT_TALL = 1.3;
/** The drift stops after this time. Then the picture rests and the loop ends. */
export const DRIFT_MS = 30_000;
/** For each satellite: an orbit, a start angle in radians, and a speed in radians for each millisecond. */
const SAT_RING = [0, 1, 2] as const;
const SAT_PHASE = [0.4, 3.2, 5.1] as const;
const SAT_SPEED = [0.00009 * 1.4, -0.00006, 0.00004] as const;
const PRODUCT_NODE_START = 0.42;
const PRODUCT_NODE_SPAN = 0.16;
const PRODUCT_LINK_START = 0.5;
const PRODUCT_LINK_SPAN = 0.2;
/** The mark radii around a slot, in CSS pixels, and the width of their lines. */
const EMPTY_RING = 4.5;
const PRODUCT_RING = 7.5;
const CURRENT_RING = 11.5;
const MARK_LINE = 0.8;
/**
 * The largest reach of any mark from its slot centre: the ring of the current product with half its
 * line, or the halo of a lit product. The orbits keep this room inside the figure inset.
 */
export const SLOT_REACH = Math.max(CURRENT_RING + MARK_LINE / 2, NODE_HALO);

export interface OrbitPlan {
  /** The lit products: one for each published product, at most `MAX_SLOTS`. */
  lit: number;
  /** All slots drawn: the lit ones and the empty rings. */
  total: number;
}

/**
 * Plan the slots for a product count. The picture keeps at least six slots so it shows room to grow.
 * The build rejects more than MAX_SLOTS products. The clamp only guards a changed page.
 */
export function planOrbit(count: number): OrbitPlan {
  const lit = Math.max(0, Math.min(Math.floor(count) || 0, MAX_SLOTS));
  return { lit, total: Math.max(MIN_SLOTS, lit) };
}

/** Give each product a share of the entrance. The last link must finish by full progress. */
export function productProgress(progress: number, index: number, count: number, part: "node" | "link"): number {
  const step = Math.min(0.08, (1 - PRODUCT_LINK_START - PRODUCT_LINK_SPAN) / Math.max(1, count - 1));
  const start = (part === "node" ? PRODUCT_NODE_START : PRODUCT_LINK_START) + index * step;
  const span = part === "node" ? PRODUCT_NODE_SPAN : PRODUCT_LINK_SPAN;
  // Compare the end first, so division cannot leave a finished mark below one.
  return progress >= start + span ? 1 : stagger(progress, start, span);
}

/** Put a slot on its orbit. `wide` is a band: the figure lies to the left and the slots turn with it. */
export function orbitSlot(out: Point, index: number, wide: boolean, cx: number, cy: number, halfWidth: number, halfHeight: number): Point {
  const away = ((wide ? -145 : -55) * Math.PI) / 180;
  const angle = away + (SLOT_OFFSET[index] * Math.PI) / 180;
  const ring = RINGS[SLOT_RING[index]];
  out.x = cx + Math.cos(angle) * ring * halfWidth;
  out.y = cy + Math.sin(angle) * ring * halfHeight;
  return out;
}

/**
 * Fit the Lyra figure with Vega at the centre (cx, cy) so the figure stays inside the
 * half box (rx, ry), with one uniform scale and a cap on its size. A wide box turns the figure a
 * quarter turn. Fills `out` and returns it.
 */
export function fitLyraAtVega(out: Point[], cx: number, cy: number, rx: number, ry: number, wide: boolean): Point[] {
  const rotate = wide ? -Math.PI / 2 : 0;
  const cos = Math.cos(rotate);
  const sin = Math.sin(rotate);
  let reachX = 0;
  let reachY = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const star of LYRA) {
    const x = star.x * cos - star.y * sin;
    const y = star.x * sin + star.y * cos;
    reachX = Math.max(reachX, Math.abs(x));
    reachY = Math.max(reachY, Math.abs(y));
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  // One uniform scale, and never bigger than the cap, so the figure has the same size and shape on every canvas.
  const scale = Math.min(rx / reachX, ry / reachY, LYRA_MAX_SIZE / Math.max(maxX - minX, maxY - minY));
  LYRA.forEach((star, i) => {
    const point = out[i] ?? (out[i] = { x: 0, y: 0 });
    point.x = cx + (star.x * cos - star.y * sin) * scale;
    point.y = cy + (star.x * sin + star.y * cos) * scale;
  });
  return out;
}

export interface OrbitBox {
  /** The half size that the orbits scale from. */
  halfWidth: number;
  halfHeight: number;
  /** A band: the figure lies to the left and the slots turn with it. */
  wide: boolean;
}

/**
 * Size the orbits from the measured box. Slots sit on the outer orbit, so the outer orbit keeps
 * SLOT_REACH inside the figure inset. Then every mark of every slot stays inside the inset.
 */
export function orbitBox(width: number, height: number): OrbitBox {
  const outer = RINGS[RINGS.length - 1];
  const room = FIGURE_INSET + SLOT_REACH;
  const halfWidth = Math.max(0, width / 2 - room) / outer;
  return {
    halfWidth,
    halfHeight: Math.min(Math.max(0, height / 2 - room) / outer, halfWidth * MAX_ORBIT_TALL),
    wide: width > height * 1.6,
  };
}

/** A link from a product to Vega, drawn in from the product. */
function drawLink(ctx: CanvasRenderingContext2D, sky: string, ax: number, ay: number, bx: number, by: number, t: number, alpha: number): void {
  if (t <= 0) return;
  const g = easeOutCubic(t);
  ctx.globalAlpha = alpha * smooth(t * 2);
  ctx.strokeStyle = sky;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(ax + (bx - ax) * g, ay + (by - ay) * g);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

export function mountProducts(container: HTMLElement): CanvasHandle | null {
  // Both product pages pass the count through the graphic component.
  const { lit, total } = planOrbit(Number(container.dataset.products));
  // The product page marks its own product, so the picture can show which star it is.
  const current = container.dataset.current === undefined ? -1 : Number(container.dataset.current);
  container.dataset.products = String(lit);

  let cx = 0;
  let cy = 0;
  let halfWidth = 0;
  let halfHeight = 0;
  let wide = false;
  let field: FieldStar[] = [];
  let mesh: Mesh | undefined;
  let labels: PlacedLabel[] = [];
  const stars: Point[] = [];
  const spots: Point[] = Array.from({ length: MAX_SLOTS }, () => ({ x: 0, y: 0 }));
  const routes: Route[] = [];

  // Rebuild the layout from the measured box. Nothing here depends on a CSS breakpoint.
  function build(s: FrameState) {
    reportFigureLeft(container, s.width, s.height);
    cx = s.width / 2;
    cy = s.height / 2;
    ({ halfWidth, halfHeight, wide } = orbitBox(s.width, s.height));
    fitLyraAtVega(stars, cx, cy, halfWidth * 0.8, halfHeight * 0.8, wide);
    for (let i = 0; i < total; i++) orbitSlot(spots[i], i, wide, cx, cy, halfWidth, halfHeight);
    routes.length = 0;
    for (let i = 0; i < Math.min(lit, 3); i++) routes.push(makeRoute([spots[i], stars[0]]));
    field = makeStarField(s.width, s.height, Math.round((s.width * s.height) / 11_000), 11);
    mesh = makeMesh(s.width, s.height, 11);
    const widthsCssPx = LYRA.map((star) => star.name ? s.labelFont.widthCssPx(star.name) : 0);
    labels = placeLabels(labelBounds(container, s.width, s.height), s.height > 300, widthsCssPx, s.labelFont.lineCssPx);
  }

  // Each name takes the side of its star that no link or product line crosses. The rings only break a tie.
  function placeLabels(bounds: Rect, showNames: boolean, widthsCssPx: readonly number[], lineCssPx: number): PlacedLabel[] {
    const segments: Segment[] = LYRA_LINKS.map(([a, b]) => ({ ax: stars[a].x, ay: stars[a].y, bx: stars[b].x, by: stars[b].y }));
    for (let i = 0; i < lit; i++) segments.push({ ax: spots[i].x, ay: spots[i].y, bx: stars[0].x, by: stars[0].y });
    const soft: Segment[] = [];
    for (const ring of RINGS) ellipseSegments(cx, cy, ring * halfWidth, ring * halfHeight, 48, soft);
    const avoid: Rect[] = stars.map((star) => around(star.x, star.y, 9));
    for (let i = 0; i < total; i++) avoid.push(around(spots[i].x, spots[i].y, 12));
    const placed: PlacedLabel[] = [];
    for (const i of [0, 4, 5]) {
      const name = LYRA[i].name;
      if (name && (i === 0 || showNames)) placed.push(placeLabel(name, stars[i].x, stars[i].y, { widthCssPx: widthsCssPx[i], lineCssPx, bounds, segments, soft, avoid, gap: i ? 12 : 14 }));
    }
    return placed;
  }

  function draw(ctx: CanvasRenderingContext2D, s: FrameState) {
    const p = s.progress;
    const pal = s.palette;
    if (mesh) drawMesh(ctx, pal, mesh, p);
    drawStarField(ctx, pal, field, p);

    // Orbits, drawn in one after another.
    ctx.lineWidth = 0.7;
    ctx.strokeStyle = pal.meta;
    for (let r = 0; r < RINGS.length; r++) {
      const g = easeOutCubic(stagger(p, 0.03 + r * 0.09, 0.36));
      if (g <= 0) continue;
      ctx.globalAlpha = 0.3 - r * 0.05;
      ctx.beginPath();
      ctx.ellipse(cx, cy, RINGS[r] * halfWidth, RINGS[r] * halfHeight, 0, -Math.PI / 2, -Math.PI / 2 + TAU * g);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Satellites: slow, and only until the drift ends. Reduced motion shows them at rest.
    ctx.fillStyle = pal.meta;
    const drift = s.reduced ? 0 : Math.min(s.activeTime, DRIFT_MS);
    const sat = smooth((p - 0.5) / 0.3);
    for (let i = 0; i < SAT_RING.length; i++) {
      const angle = SAT_PHASE[i] + drift * SAT_SPEED[i];
      ctx.globalAlpha = 0.55 * sat;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(angle) * RINGS[SAT_RING[i]] * halfWidth, cy + Math.sin(angle) * RINGS[SAT_RING[i]] * halfHeight, 1.1, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // The Lyra figure.
    for (let i = 0; i < LYRA_LINKS.length; i++) {
      const [a, b] = LYRA_LINKS[i];
      drawEdge(ctx, pal, stars[a].x, stars[a].y, stars[b].x, stars[b].y, stagger(p, 0.14 + i * 0.05, 0.2), i < 2, 0.4);
    }
    for (let i = 0; i < stars.length; i++) drawNode(ctx, pal, s.glow, stars[i].x, stars[i].y, i ? 1.8 : 2.6, stagger(p, 0.1 + i * 0.05, 0.14), i === 0, 0.9, i === 0);

    // Empty rings: room to grow.
    ctx.strokeStyle = pal.meta;
    ctx.lineWidth = 0.7;
    for (let i = lit; i < total; i++) {
      const g = smooth(stagger(p, 0.3 + i * 0.03, 0.2));
      if (g <= 0) continue;
      ctx.globalAlpha = 0.42 * g;
      ctx.beginPath();
      ctx.arc(spots[i].x, spots[i].y, EMPTY_RING, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // The products ignite in turn, each with a link to Vega.
    for (let i = 0; i < lit; i++) {
      const g = productProgress(p, i, lit, "node");
      drawLink(ctx, pal.sky, spots[i].x, spots[i].y, stars[0].x, stars[0].y, productProgress(p, i, lit, "link"), 0.32);
      drawNode(ctx, pal, s.glow, spots[i].x, spots[i].y, 2.6, g, true, 1, false);
      if (g > 0) {
        ctx.strokeStyle = pal.sky;
        ctx.lineWidth = MARK_LINE;
        ctx.globalAlpha = 0.5 * easeOutCubic(g);
        ctx.beginPath();
        ctx.arc(spots[i].x, spots[i].y, PRODUCT_RING, 0, TAU);
        ctx.stroke();
        if (i === current) {
          ctx.globalAlpha = 0.9 * easeOutCubic(g);
          ctx.beginPath();
          ctx.arc(spots[i].x, spots[i].y, CURRENT_RING, 0, TAU);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }

    // Comets converge on Vega, then the bloom. Both are part of the entrance only.
    if (!s.entranceComplete) {
      for (let i = 0; i < routes.length; i++) drawComet(ctx, pal, s.glow, routes[i], stagger(p, 0.5 + i * 0.05, 0.4), 46);
      drawVegaBloom(ctx, s.glow, stars[0].x, stars[0].y, smooth((p - 0.66) / 0.2) * (1 - smooth((p - 0.86) / 0.14)));
    }

    const label = smooth((p - 0.7) / 0.2);
    for (let i = 0; i < labels.length; i++) drawLabel(ctx, pal, s.labelFont.canvasFont, labels[i].text, labels[i].x, labels[i].y, labels[i].align, label);

    // Ask for more frames only while the satellites still drift.
    return !s.reduced && s.activeTime < DRIFT_MS;
  }

  return mountCanvas(container, { draw, onResize: build });
}
