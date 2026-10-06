import type { Point } from "../../motion/easing.ts";
import { LYRA, LYRA_LINKS } from "../../lyra/constellation.ts";
import { stagger } from "../clock.ts";
import { around, ellipseSegments, labelBounds, placeLabel, type PlacedLabel, type Rect, type Segment } from "../labels.ts";
import { FIGURE_INSET, reportFigureLeft } from "../inset.ts";
import { LYRA_MAX_SIZE } from "../lyra.ts";
import { drawMesh, makeMesh, type Mesh } from "../mesh.ts";
import { drawComet, drawEdge, drawLabel, drawNode, drawStarField, drawVegaBloom, makeRoute, makeStarField, type FieldStar, type Route } from "../marks.ts";
import { easeOutCubic, smooth, TAU } from "../math.ts";
import { mountCanvas, type CanvasHandle, type FrameState } from "../mount.ts";

// Constellation lattice: the products are ringed stars on elliptical orbits round Vega,
// and each one links to the Lyra figure. A published product is lit. Faint empty rings
// with no label show room to grow. Three small satellites drift on the orbits for
// a short time, then rest.

/** The orbit radii, as a share of the half box. */
const RINGS = [0.36, 0.66, 0.95] as const;
/** The angle of each slot from the direction away from the figure, in degrees. */
const SLOT_OFFSET = [0, 52, -52, -112, 112, 172, -165, 30] as const;
/** The orbit that each slot sits on. */
const SLOT_RING = [1, 2, 0, 2, 0, 2, 1, 2] as const;
/** The picture always shows this many slots, and never more than the maximum. */
export const MIN_SLOTS = 6;
export const MAX_SLOTS = SLOT_OFFSET.length;
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

export interface OrbitPlan {
  /** The lit products: one for each published product, at most `MAX_SLOTS`. */
  lit: number;
  /** All slots drawn: the lit ones and the empty rings. */
  total: number;
}

/** Plan the slots for a product count. The picture keeps at least six slots so it shows room to grow. */
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
export function orbitSlot(out: Point, index: number, wide: boolean, cx: number, cy: number, hw: number, hh: number): Point {
  const away = ((wide ? -145 : -55) * Math.PI) / 180;
  const angle = away + (SLOT_OFFSET[index] * Math.PI) / 180;
  const ring = RINGS[SLOT_RING[index]];
  out.x = cx + Math.cos(angle) * ring * hw;
  out.y = cy + Math.sin(angle) * ring * hh;
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

/** The half size that the orbits scale from. The outer orbit fits inside the figure inset. */
export function orbitBox(w: number, h: number): { hw: number; hh: number } {
  const outer = RINGS[RINGS.length - 1];
  const hw = (w / 2 - FIGURE_INSET) / outer;
  return { hw, hh: Math.min((h / 2 - FIGURE_INSET) / outer, hw * MAX_ORBIT_TALL) };
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
  let hw = 0;
  let hh = 0;
  let wide = false;
  let field: FieldStar[] = [];
  let mesh: Mesh | undefined;
  let labels: PlacedLabel[] = [];
  const stars: Point[] = [];
  const spots: Point[] = Array.from({ length: MAX_SLOTS }, () => ({ x: 0, y: 0 }));
  const routes: Route[] = [];

  // Rebuild the layout from the measured box. Nothing here depends on a CSS breakpoint.
  function build(s: FrameState) {
    reportFigureLeft(container, s.w, s.h);
    cx = s.w / 2;
    cy = s.h / 2;
    ({ hw, hh } = orbitBox(s.w, s.h));
    wide = s.w > s.h * 1.6;
    fitLyraAtVega(stars, cx, cy, hw * 0.8, hh * 0.8, wide);
    for (let i = 0; i < total; i++) orbitSlot(spots[i], i, wide, cx, cy, hw, hh);
    routes.length = 0;
    for (let i = 0; i < Math.min(lit, 3); i++) routes.push(makeRoute([spots[i], stars[0]]));
    field = makeStarField(s.w, s.h, Math.round((s.w * s.h) / 11_000), 11);
    mesh = makeMesh(s.w, s.h, 11);
    labels = placeLabels(labelBounds(container, s.w, s.h), s.h > 300);
  }

  // Each name takes the side of its star that no link or product line crosses. The rings only break a tie.
  function placeLabels(bounds: Rect, showNames: boolean): PlacedLabel[] {
    const segments: Segment[] = LYRA_LINKS.map(([a, b]) => ({ ax: stars[a].x, ay: stars[a].y, bx: stars[b].x, by: stars[b].y }));
    for (let i = 0; i < lit; i++) segments.push({ ax: spots[i].x, ay: spots[i].y, bx: stars[0].x, by: stars[0].y });
    const soft: Segment[] = [];
    for (const ring of RINGS) ellipseSegments(cx, cy, ring * hw, ring * hh, 48, soft);
    const avoid: Rect[] = stars.map((star) => around(star.x, star.y, 9));
    for (let i = 0; i < total; i++) avoid.push(around(spots[i].x, spots[i].y, 12));
    const placed: PlacedLabel[] = [];
    for (const i of [0, 4, 5]) {
      const name = LYRA[i].name;
      if (name && (i === 0 || showNames)) placed.push(placeLabel(name, stars[i].x, stars[i].y, { bounds, segments, soft, avoid, gap: i ? 12 : 14 }));
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
      ctx.ellipse(cx, cy, RINGS[r] * hw, RINGS[r] * hh, 0, -Math.PI / 2, -Math.PI / 2 + TAU * g);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Satellites: slow, and only until the drift ends. Reduced motion shows them at rest.
    ctx.fillStyle = pal.meta;
    const drift = s.reduced ? 0 : Math.min(s.t, DRIFT_MS);
    const sat = smooth((p - 0.5) / 0.3);
    for (let i = 0; i < SAT_RING.length; i++) {
      const angle = SAT_PHASE[i] + drift * SAT_SPEED[i];
      ctx.globalAlpha = 0.55 * sat;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(angle) * RINGS[SAT_RING[i]] * hw, cy + Math.sin(angle) * RINGS[SAT_RING[i]] * hh, 1.1, 0, TAU);
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
      ctx.arc(spots[i].x, spots[i].y, 4.5, 0, TAU);
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
        ctx.lineWidth = 0.8;
        ctx.globalAlpha = 0.5 * easeOutCubic(g);
        ctx.beginPath();
        ctx.arc(spots[i].x, spots[i].y, 7.5, 0, TAU);
        ctx.stroke();
        if (i === current) {
          ctx.globalAlpha = 0.9 * easeOutCubic(g);
          ctx.beginPath();
          ctx.arc(spots[i].x, spots[i].y, 11.5, 0, TAU);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }

    // Comets converge on Vega, then the bloom. Both are part of the entrance only.
    if (!s.still) {
      for (let i = 0; i < routes.length; i++) drawComet(ctx, pal, s.glow, routes[i], stagger(p, 0.5 + i * 0.05, 0.4), 46);
      drawVegaBloom(ctx, s.glow, stars[0].x, stars[0].y, smooth((p - 0.66) / 0.2) * (1 - smooth((p - 0.86) / 0.14)));
    }

    const label = smooth((p - 0.7) / 0.2);
    for (let i = 0; i < labels.length; i++) drawLabel(ctx, pal, labels[i].text, labels[i].x, labels[i].y, labels[i].align, label);

    // Ask for more frames only while the satellites still drift.
    return !s.reduced && s.t < DRIFT_MS;
  }

  return mountCanvas(container, { draw, onResize: build });
}
