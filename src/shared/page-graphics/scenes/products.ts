import type { Point } from "../../motion/easing.ts";
import { LYRA_LINKS } from "../../lyra/constellation.ts";
import { stagger } from "../../motion/clock.ts";
import { around, ellipseSegments, labelBounds, type PlacedLabel, type Rectangle, type Segment } from "../labels.ts";
import { FIGURE_INSET, reportFigureLeft } from "../inset.ts";
import { fitLyraAtVega, lyraLinkSegments, placeStarNames, starNameWidths } from "../lyra.ts";
import { drawMesh, makeMesh, type Mesh } from "../mesh.ts";
import {
  drawComet,
  drawEdge,
  drawLabel,
  drawNode,
  drawStarField,
  drawVegaBloom,
  makeRoute,
  makeStarField,
  NODE_HALO,
  type FieldStar,
  type Route,
} from "../marks.ts";
import { easeOutCubic, riseAndFall, smooth, FULL_TURN_RADIANS } from "../math.ts";
import { mountCanvas, type CanvasHandle, type FrameState } from "../mount.ts";
import { MAXIMUM_SLOTS, SLOT_OFFSET, SLOT_RING } from "./product-slots.ts";

// Constellation lattice: the products are ringed stars on elliptical orbits round Vega,
// and each one links to the Lyra figure. A published product is lit. Faint empty rings
// with no label show room to grow. Three small satellites drift on the orbits for
// a short time, then rest.

/** The orbit radii, as a share of the half box. */
const RINGS = [0.36, 0.66, 0.95] as const;
/** The picture always shows this many slots, and never more than MAXIMUM_SLOTS in product-slots.ts. */
export const MINIMUM_SLOTS = 6;
/** A tall box gives the orbits at most this ratio of height to width, so a column does not stretch them. */
const MAXIMUM_ORBIT_HEIGHT_RATIO = 1.3;
/** The drift stops after this time. Then the picture rests and the loop ends. */
const DRIFT_DURATION_MILLISECONDS = 30_000;
/** For each satellite: an orbit, a start angle in radians, and a speed in radians for each millisecond. */
const SATELLITE_RING = [0, 1, 2] as const;
const SATELLITE_PHASE = [0.4, 3.2, 5.1] as const;
const SATELLITE_SPEED = [0.00009 * 1.4, -0.00006, 0.00004] as const;
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
const SLOT_REACH = Math.max(CURRENT_RING + MARK_LINE / 2, NODE_HALO);

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

/** A link from a product to Vega, drawn in from the product. */
function drawLink(
  drawingContext: CanvasRenderingContext2D,
  sky: string,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  progress: number,
  alpha: number,
): void {
  if (progress <= 0) return;
  const growth = easeOutCubic(progress);
  drawingContext.globalAlpha = alpha * smooth(progress * 2);
  drawingContext.strokeStyle = sky;
  drawingContext.lineWidth = 0.8;
  drawingContext.beginPath();
  drawingContext.moveTo(ax, ay);
  drawingContext.lineTo(ax + (bx - ax) * growth, ay + (by - ay) * growth);
  drawingContext.stroke();
  drawingContext.globalAlpha = 1;
}

export function mountProducts(container: HTMLElement): CanvasHandle | null {
  // Both product pages pass the count through the graphic component.
  const { lit: litProductCount, total: slotCount } = planOrbit(Number(container.dataset.products));
  // The product page marks its own product, so the picture can show which star it is.
  const currentProductIndex = container.dataset.current === undefined ? -1 : Number(container.dataset.current);
  container.dataset.products = String(litProductCount);

  let cx = 0;
  let cy = 0;
  let halfWidth = 0;
  let halfHeight = 0;
  let wide = false;
  let field: FieldStar[] = [];
  let mesh: Mesh | undefined;
  let labels: PlacedLabel[] = [];
  const stars: Point[] = [];
  const spots: Point[] = Array.from({ length: MAXIMUM_SLOTS }, () => ({ x: 0, y: 0 }));
  const routes: Route[] = [];

  // Rebuild the layout from the measured box. Nothing here depends on a CSS breakpoint.
  function build(state: FrameState) {
    reportFigureLeft(container);
    cx = state.width / 2;
    cy = state.height / 2;
    ({ halfWidth, halfHeight, wide } = orbitBox(state.width, state.height));
    fitLyraAtVega(stars, cx, cy, halfWidth * 0.8, halfHeight * 0.8, wide);
    for (let i = 0; i < slotCount; i++) orbitSlot(spots[i], i, wide, cx, cy, halfWidth, halfHeight);
    routes.length = 0;
    for (let i = 0; i < Math.min(litProductCount, 3); i++) routes.push(makeRoute([spots[i], stars[0]]));
    field = makeStarField(state.width, state.height, Math.round((state.width * state.height) / 11_000), 11);
    mesh = makeMesh(state.width, state.height, 11);
    // Each name takes the side of its star that no link or product line crosses. The rings only break a tie.
    const segments: Segment[] = lyraLinkSegments(stars);
    for (let i = 0; i < litProductCount; i++) segments.push({ ax: spots[i].x, ay: spots[i].y, bx: stars[0].x, by: stars[0].y });
    const soft: Segment[] = [];
    for (const ring of RINGS) ellipseSegments(cx, cy, ring * halfWidth, ring * halfHeight, 48, soft);
    const avoid: Rectangle[] = stars.map((star) => around(star.x, star.y, 9));
    for (let i = 0; i < slotCount; i++) avoid.push(around(spots[i].x, spots[i].y, 12));
    labels = placeStarNames(stars, {
      bounds: labelBounds(container, state.width, state.height),
      showNames: state.height > 300,
      widthsInPixels: starNameWidths(state.labelFont),
      lineHeightInPixels: state.labelFont.lineHeightInPixels,
      segments,
      soft,
      avoid,
    });
  }

  function draw(drawingContext: CanvasRenderingContext2D, state: FrameState) {
    const progress = state.progress;
    const palette = state.palette;
    if (mesh) drawMesh(drawingContext, palette, mesh, progress);
    drawStarField(drawingContext, palette, field, progress);

    // Orbits, drawn in one after another.
    drawingContext.lineWidth = 0.7;
    drawingContext.strokeStyle = palette.metadata;
    for (let ringIndex = 0; ringIndex < RINGS.length; ringIndex++) {
      const growth = easeOutCubic(stagger(progress, 0.03 + ringIndex * 0.09, 0.36));
      if (growth <= 0) continue;
      drawingContext.globalAlpha = 0.3 - ringIndex * 0.05;
      drawingContext.beginPath();
      drawingContext.ellipse(
        cx,
        cy,
        RINGS[ringIndex] * halfWidth,
        RINGS[ringIndex] * halfHeight,
        0,
        -Math.PI / 2,
        -Math.PI / 2 + FULL_TURN_RADIANS * growth,
      );
      drawingContext.stroke();
    }
    drawingContext.globalAlpha = 1;

    // Satellites: slow, and only until the drift ends. Reduced motion shows them at rest.
    drawingContext.fillStyle = palette.metadata;
    const drift = state.reduced ? 0 : Math.min(state.activeTime, DRIFT_DURATION_MILLISECONDS);
    const satelliteProgress = smooth((progress - 0.5) / 0.3);
    for (let i = 0; i < SATELLITE_RING.length; i++) {
      const angle = SATELLITE_PHASE[i] + drift * SATELLITE_SPEED[i];
      drawingContext.globalAlpha = 0.55 * satelliteProgress;
      drawingContext.beginPath();
      drawingContext.arc(
        cx + Math.cos(angle) * RINGS[SATELLITE_RING[i]] * halfWidth,
        cy + Math.sin(angle) * RINGS[SATELLITE_RING[i]] * halfHeight,
        1.1,
        0,
        FULL_TURN_RADIANS,
      );
      drawingContext.fill();
    }
    drawingContext.globalAlpha = 1;

    // The Lyra figure.
    for (let i = 0; i < LYRA_LINKS.length; i++) {
      const [a, b] = LYRA_LINKS[i];
      drawEdge(
        drawingContext,
        palette,
        stars[a].x,
        stars[a].y,
        stars[b].x,
        stars[b].y,
        stagger(progress, 0.14 + i * 0.05, 0.2),
        i < 2,
        0.4,
      );
    }
    for (let i = 0; i < stars.length; i++) {
      drawNode(
        drawingContext,
        palette,
        state.glow,
        stars[i].x,
        stars[i].y,
        i ? 1.8 : 2.6,
        stagger(progress, 0.1 + i * 0.05, 0.14),
        i === 0,
        0.9,
        i === 0,
      );
    }

    // Empty rings: room to grow.
    drawingContext.strokeStyle = palette.metadata;
    drawingContext.lineWidth = 0.7;
    for (let i = litProductCount; i < slotCount; i++) {
      const growth = smooth(stagger(progress, 0.3 + i * 0.03, 0.2));
      if (growth <= 0) continue;
      drawingContext.globalAlpha = 0.42 * growth;
      drawingContext.beginPath();
      drawingContext.arc(spots[i].x, spots[i].y, EMPTY_RING, 0, FULL_TURN_RADIANS);
      drawingContext.stroke();
    }
    drawingContext.globalAlpha = 1;

    // The products ignite in turn, each with a link to Vega.
    for (let i = 0; i < litProductCount; i++) {
      const growth = productProgress(progress, i, litProductCount, "node");
      drawLink(
        drawingContext,
        palette.sky,
        spots[i].x,
        spots[i].y,
        stars[0].x,
        stars[0].y,
        productProgress(progress, i, litProductCount, "link"),
        0.32,
      );
      drawNode(
        drawingContext,
        palette,
        state.glow,
        spots[i].x,
        spots[i].y,
        2.6,
        growth,
        true,
        1,
        false,
      );
      if (growth > 0) {
        drawingContext.strokeStyle = palette.sky;
        drawingContext.lineWidth = MARK_LINE;
        drawingContext.globalAlpha = 0.5 * easeOutCubic(growth);
        drawingContext.beginPath();
        drawingContext.arc(spots[i].x, spots[i].y, PRODUCT_RING, 0, FULL_TURN_RADIANS);
        drawingContext.stroke();
        if (i === currentProductIndex) {
          drawingContext.globalAlpha = 0.9 * easeOutCubic(growth);
          drawingContext.beginPath();
          drawingContext.arc(spots[i].x, spots[i].y, CURRENT_RING, 0, FULL_TURN_RADIANS);
          drawingContext.stroke();
        }
        drawingContext.globalAlpha = 1;
      }
    }

    // Comets converge on Vega, then the bloom. Both are part of the entrance only.
    if (!state.entranceComplete) {
      for (let i = 0; i < routes.length; i++) {
        drawComet(
          drawingContext,
          palette,
          state.glow,
          routes[i],
          stagger(progress, 0.5 + i * 0.05, 0.4),
          46,
        );
      }
      drawVegaBloom(
        drawingContext,
        state.glow,
        stars[0].x,
        stars[0].y,
        riseAndFall(progress, 0.66, 0.2, 0.86, 0.14),
      );
    }

    const labelProgress = smooth((progress - 0.7) / 0.2);
    for (let i = 0; i < labels.length; i++) {
      drawLabel(
        drawingContext,
        palette,
        state.labelFont.canvasFont,
        labels[i].text,
        labels[i].x,
        labels[i].y,
        labels[i].align,
        labelProgress,
      );
    }

    // Ask for more frames only while the satellites still drift.
    return !state.reduced && state.activeTime < DRIFT_DURATION_MILLISECONDS;
  }

  return mountCanvas(container, { draw, onResize: build });
}
