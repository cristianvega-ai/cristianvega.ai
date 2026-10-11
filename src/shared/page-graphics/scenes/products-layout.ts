import { stagger } from "../../motion/clock.ts";
import { makeRoute, type Route } from "../../motion/comets.ts";
import type { Point } from "../../motion/geometry.ts";
import { NODE_HALO } from "../../motion/marks.ts";
import { FIGURE_INSET } from "../inset.ts";
import { around, ellipseSegments, type Rectangle, type Segment } from "../labels.ts";
import { fitLyraAtVega, lyraLinkSegments } from "../lyra.ts";
import { MAXIMUM_SLOTS, SLOT_OFFSET, SLOT_RING } from "./product-slots.ts";

// The layout of the Products graphic, "Constellation lattice". It has no DOM and no canvas,
// so a test can run it. Build the layout on resize, not per frame.

/** The orbit radii, as a share of the half box. */
export const RINGS = [0.36, 0.66, 0.95] as const;
/** The picture always shows this many slots, and never more than MAXIMUM_SLOTS in product-slots.ts. */
export const MINIMUM_SLOTS = 6;
/** A tall box gives the orbits at most this ratio of height to width, so a column does not stretch them. */
const MAXIMUM_ORBIT_HEIGHT_RATIO = 1.3;
const PRODUCT_NODE_START = 0.42;
const PRODUCT_NODE_SPAN = 0.16;
const PRODUCT_LINK_START = 0.5;
const PRODUCT_LINK_SPAN = 0.2;
/** The mark radii around a slot, in CSS pixels, and the width of their lines. */
export const EMPTY_RING = 4.5;
export const PRODUCT_RING = 7.5;
export const CURRENT_RING = 11.5;
export const MARK_LINE = 0.8;
/**
 * The largest reach of any mark from its slot centre: the ring of the current product with half its
 * line, or the halo of a lit product. The orbits keep this room inside the figure inset.
 */
const SLOT_REACH = Math.max(CURRENT_RING + MARK_LINE / 2, NODE_HALO);
/** The first lit products send a comet to Vega during the entrance. */
const COMET_COUNT = 3;

interface OrbitPlan {
  /** The lit products: one for each published product, at most `MAXIMUM_SLOTS`. */
  lit: number;
  /** All slots drawn: the lit ones and the empty rings. */
  total: number;
}

/**
 * Plan the slots for a product count. The picture keeps at least six slots so it shows room to grow.
 * The build rejects more than MAXIMUM_SLOTS products. The clamp only guards a changed page.
 */
export function planOrbit(count: number): OrbitPlan {
  const lit = Math.max(0, Math.min(Math.floor(count) || 0, MAXIMUM_SLOTS));
  return { lit, total: Math.max(MINIMUM_SLOTS, lit) };
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
export function orbitSlot(
  output: Point,
  index: number,
  wide: boolean,
  cx: number,
  cy: number,
  halfWidth: number,
  halfHeight: number,
): Point {
  const away = ((wide ? -145 : -55) * Math.PI) / 180;
  const angle = away + (SLOT_OFFSET[index] * Math.PI) / 180;
  const ring = RINGS[SLOT_RING[index]];
  output.x = cx + Math.cos(angle) * ring * halfWidth;
  output.y = cy + Math.sin(angle) * ring * halfHeight;
  return output;
}

interface OrbitBox {
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
function orbitBox(width: number, height: number): OrbitBox {
  const outer = RINGS[RINGS.length - 1];
  const room = FIGURE_INSET + SLOT_REACH;
  const halfWidth = Math.max(0, width / 2 - room) / outer;
  return {
    halfWidth,
    halfHeight: Math.min(Math.max(0, height / 2 - room) / outer, halfWidth * MAXIMUM_ORBIT_HEIGHT_RATIO),
    wide: width > height * 1.6,
  };
}

export interface Orbit extends OrbitBox {
  /** The centre of the orbits, where Vega sits. */
  centerX: number;
  centerY: number;
  /** The Lyra stars, with Vega first. */
  stars: Point[];
  /** One point for each slot, up to MAXIMUM_SLOTS. Only the planned slots are current. */
  spots: Point[];
  /** The comet routes from the first lit products to Vega. */
  routes: Route[];
}

/** An empty orbit to fill with layoutOrbit. */
export function createOrbit(): Orbit {
  return {
    centerX: 0,
    centerY: 0,
    halfWidth: 0,
    halfHeight: 0,
    wide: false,
    stars: [],
    spots: Array.from({ length: MAXIMUM_SLOTS }, () => ({ x: 0, y: 0 })),
    routes: [],
  };
}

/** Lay out the orbits, the figure, the slots, and the comet routes for the box. Fills `orbit` and returns it. */
export function layoutOrbit(width: number, height: number, plan: OrbitPlan, orbit: Orbit): Orbit {
  orbit.centerX = width / 2;
  orbit.centerY = height / 2;
  Object.assign(orbit, orbitBox(width, height));
  const { centerX, centerY, halfWidth, halfHeight, wide, stars, spots, routes } = orbit;
  fitLyraAtVega(stars, centerX, centerY, halfWidth * 0.8, halfHeight * 0.8, wide);
  for (let i = 0; i < plan.total; i++) orbitSlot(spots[i], i, wide, centerX, centerY, halfWidth, halfHeight);
  routes.length = 0;
  for (let i = 0; i < Math.min(plan.lit, COMET_COUNT); i++) routes.push(makeRoute([spots[i], stars[0]]));
  return orbit;
}

/**
 * What a star name must keep clear of. No name may cross a figure link or a product line. The rings
 * only break a tie. The stars and the slots are marks to avoid.
 */
export function orbitLabelObstacles(orbit: Orbit, plan: OrbitPlan): { segments: Segment[]; soft: Segment[]; avoid: Rectangle[] } {
  const { centerX, centerY, halfWidth, halfHeight, stars, spots } = orbit;
  const segments: Segment[] = lyraLinkSegments(stars);
  for (let i = 0; i < plan.lit; i++) segments.push({ ax: spots[i].x, ay: spots[i].y, bx: stars[0].x, by: stars[0].y });
  const soft: Segment[] = [];
  for (const ring of RINGS) ellipseSegments(centerX, centerY, ring * halfWidth, ring * halfHeight, 48, soft);
  const avoid: Rectangle[] = stars.map((star) => around(star.x, star.y, 9));
  for (let i = 0; i < plan.total; i++) avoid.push(around(spots[i].x, spots[i].y, 12));
  return { segments, soft, avoid };
}
