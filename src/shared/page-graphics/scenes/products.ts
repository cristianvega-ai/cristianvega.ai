import { LYRA_LINKS } from "../../lyra/constellation.ts";
import { stagger } from "../../canvas/clock.ts";
import { drawComet } from "../../canvas/comets.ts";
import { easeOutCubic, riseAndFall, smooth } from "../../canvas/easing.ts";
import { FULL_TURN_RADIANS } from "../../canvas/geometry.ts";
import { drawEdge, drawNode, drawVegaBloom } from "../../canvas/marks.ts";
import type { Palette } from "../../canvas/palette.ts";
import { drawStarField, makeStarField, type FieldStar } from "../../canvas/star-field.ts";
import { labelBounds, reportFigureLeft } from "../container.ts";
import { drawLabels, type PlacedLabel } from "../labels.ts";
import { placeStarNames, starNameWidths } from "../lyra.ts";
import { drawMesh, makeMesh, type Mesh } from "../mesh.ts";
import { mountCanvas, type CanvasHandle, type FrameState } from "../mount.ts";
import {
  createOrbit,
  CURRENT_RING,
  EMPTY_RING,
  layoutOrbit,
  MARK_LINE,
  orbitLabelObstacles,
  planOrbit,
  PRODUCT_RING,
  productProgress,
  RINGS,
  type Orbit,
} from "./products-layout.ts";

// Constellation lattice: the products are ringed stars on elliptical orbits round Vega,
// and each one links to the Lyra figure. A published product is lit. Faint empty rings
// with no label show room to grow. Three small satellites drift on the orbits for
// a short time, then rest.

/** The drift stops after this time. Then the picture rests and the loop ends. */
const DRIFT_DURATION_MILLISECONDS = 30_000;
/** For each satellite: an orbit, a start angle in radians, and a speed in radians for each millisecond. */
const SATELLITE_RING = [0, 1, 2] as const;
const SATELLITE_PHASE = [0.4, 3.2, 5.1] as const;
const SATELLITE_SPEED = [0.00009 * 1.4, -0.00006, 0.00004] as const;

/** A link from a product to Vega, drawn in from the product. */
function drawLink(
  drawingContext: CanvasRenderingContext2D,
  sky: string,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  progress: number,
  alpha: number,
): void {
  if (progress <= 0) return;
  const growth = easeOutCubic(progress);
  drawingContext.globalAlpha = alpha * smooth(progress * 2);
  drawingContext.strokeStyle = sky;
  drawingContext.lineWidth = 0.8;
  drawingContext.beginPath();
  drawingContext.moveTo(startX, startY);
  drawingContext.lineTo(startX + (endX - startX) * growth, startY + (endY - startY) * growth);
  drawingContext.stroke();
  drawingContext.globalAlpha = 1;
}

/** The orbits, drawn in one after another. */
function drawOrbits(drawingContext: CanvasRenderingContext2D, palette: Palette, orbit: Orbit, progress: number): void {
  drawingContext.lineWidth = 0.7;
  drawingContext.strokeStyle = palette.metadata;
  for (let ringIndex = 0; ringIndex < RINGS.length; ringIndex++) {
    const growth = easeOutCubic(stagger(progress, 0.03 + ringIndex * 0.09, 0.36));
    if (growth <= 0) continue;
    drawingContext.globalAlpha = 0.3 - ringIndex * 0.05;
    drawingContext.beginPath();
    drawingContext.ellipse(
      orbit.centerX,
      orbit.centerY,
      RINGS[ringIndex] * orbit.halfWidth,
      RINGS[ringIndex] * orbit.halfHeight,
      0,
      -Math.PI / 2,
      -Math.PI / 2 + FULL_TURN_RADIANS * growth,
    );
    drawingContext.stroke();
  }
  drawingContext.globalAlpha = 1;
}

/** The satellites: slow, and only until the drift ends. Reduced motion shows them at rest. */
function drawSatellites(drawingContext: CanvasRenderingContext2D, palette: Palette, orbit: Orbit, state: FrameState): void {
  drawingContext.fillStyle = palette.metadata;
  const drift = state.reduced ? 0 : Math.min(state.activeTime, DRIFT_DURATION_MILLISECONDS);
  const satelliteProgress = smooth((state.progress - 0.5) / 0.3);
  for (let satelliteIndex = 0; satelliteIndex < SATELLITE_RING.length; satelliteIndex++) {
    const angle = SATELLITE_PHASE[satelliteIndex] + drift * SATELLITE_SPEED[satelliteIndex];
    drawingContext.globalAlpha = 0.55 * satelliteProgress;
    drawingContext.beginPath();
    drawingContext.arc(
      orbit.centerX + Math.cos(angle) * RINGS[SATELLITE_RING[satelliteIndex]] * orbit.halfWidth,
      orbit.centerY + Math.sin(angle) * RINGS[SATELLITE_RING[satelliteIndex]] * orbit.halfHeight,
      1.1,
      0,
      FULL_TURN_RADIANS,
    );
    drawingContext.fill();
  }
  drawingContext.globalAlpha = 1;
}

/** The Lyra figure: its links, then its stars. */
function drawFigure(drawingContext: CanvasRenderingContext2D, palette: Palette, glow: HTMLCanvasElement, orbit: Orbit, progress: number): void {
  const { stars } = orbit;
  for (let linkIndex = 0; linkIndex < LYRA_LINKS.length; linkIndex++) {
    const [startIndex, endIndex] = LYRA_LINKS[linkIndex];
    drawEdge(
      drawingContext,
      palette,
      stars[startIndex].x,
      stars[startIndex].y,
      stars[endIndex].x,
      stars[endIndex].y,
      stagger(progress, 0.14 + linkIndex * 0.05, 0.2),
      linkIndex < 2,
      0.4,
    );
  }
  for (let starIndex = 0; starIndex < stars.length; starIndex++) {
    drawNode(
      drawingContext,
      palette,
      glow,
      stars[starIndex].x,
      stars[starIndex].y,
      starIndex ? 1.8 : 2.6,
      stagger(progress, 0.1 + starIndex * 0.05, 0.14),
      starIndex === 0,
      0.9,
      starIndex === 0,
    );
  }
}

/** The empty rings after the lit products: room to grow. */
function drawEmptyRings(
  drawingContext: CanvasRenderingContext2D,
  palette: Palette,
  orbit: Orbit,
  litProductCount: number,
  slotCount: number,
  progress: number,
): void {
  drawingContext.strokeStyle = palette.metadata;
  drawingContext.lineWidth = 0.7;
  for (let slotIndex = litProductCount; slotIndex < slotCount; slotIndex++) {
    const growth = smooth(stagger(progress, 0.3 + slotIndex * 0.03, 0.2));
    if (growth <= 0) continue;
    drawingContext.globalAlpha = 0.42 * growth;
    drawingContext.beginPath();
    drawingContext.arc(orbit.spots[slotIndex].x, orbit.spots[slotIndex].y, EMPTY_RING, 0, FULL_TURN_RADIANS);
    drawingContext.stroke();
  }
  drawingContext.globalAlpha = 1;
}

/** The products ignite in turn, each with a link to Vega. The current product has a second ring. */
function drawProducts(
  drawingContext: CanvasRenderingContext2D,
  palette: Palette,
  glow: HTMLCanvasElement,
  orbit: Orbit,
  litProductCount: number,
  currentProductIndex: number,
  progress: number,
): void {
  const { stars, spots } = orbit;
  for (let productIndex = 0; productIndex < litProductCount; productIndex++) {
    const growth = productProgress(progress, productIndex, litProductCount, "node");
    drawLink(
      drawingContext,
      palette.sky,
      spots[productIndex].x,
      spots[productIndex].y,
      stars[0].x,
      stars[0].y,
      productProgress(progress, productIndex, litProductCount, "link"),
      0.32,
    );
    drawNode(
      drawingContext,
      palette,
      glow,
      spots[productIndex].x,
      spots[productIndex].y,
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
      drawingContext.arc(spots[productIndex].x, spots[productIndex].y, PRODUCT_RING, 0, FULL_TURN_RADIANS);
      drawingContext.stroke();
      if (productIndex === currentProductIndex) {
        drawingContext.globalAlpha = 0.9 * easeOutCubic(growth);
        drawingContext.beginPath();
        drawingContext.arc(spots[productIndex].x, spots[productIndex].y, CURRENT_RING, 0, FULL_TURN_RADIANS);
        drawingContext.stroke();
      }
      drawingContext.globalAlpha = 1;
    }
  }
}

/** Comets converge on Vega, then the bloom. Both are part of the entrance only. */
function drawSignals(drawingContext: CanvasRenderingContext2D, palette: Palette, glow: HTMLCanvasElement, orbit: Orbit, progress: number): void {
  for (let routeIndex = 0; routeIndex < orbit.routes.length; routeIndex++) {
    drawComet(
      drawingContext,
      palette,
      glow,
      orbit.routes[routeIndex],
      stagger(progress, 0.5 + routeIndex * 0.05, 0.4),
      46,
    );
  }
  drawVegaBloom(
    drawingContext,
    glow,
    orbit.stars[0].x,
    orbit.stars[0].y,
    riseAndFall(progress, 0.66, 0.2, 0.86, 0.14),
  );
}

export function mountProducts(container: HTMLElement): CanvasHandle | null {
  // Both product pages pass the count through the graphic component.
  const plan = planOrbit(Number(container.dataset.products));
  // The product page marks its own product, so the picture can show which star it is.
  const currentProductIndex = container.dataset.current === undefined ? -1 : Number(container.dataset.current);
  container.dataset.products = String(plan.lit);

  const orbit = createOrbit();
  let field: FieldStar[] = [];
  let mesh: Mesh | undefined;
  let labels: PlacedLabel[] = [];

  // Rebuild the layout from the measured box. Nothing here depends on a CSS breakpoint.
  function build(state: FrameState) {
    reportFigureLeft(container);
    layoutOrbit(state.width, state.height, plan, orbit);
    field = makeStarField(state.width, state.height, Math.round((state.width * state.height) / 11_000), 11);
    mesh = makeMesh(state.width, state.height, 11);
    labels = placeStarNames(orbit.stars, {
      bounds: labelBounds(container, state.width, state.height),
      showNames: state.height > 300,
      widthsInPixels: starNameWidths(state.labelFont),
      lineHeightInPixels: state.labelFont.lineHeightInPixels,
      ...orbitLabelObstacles(orbit, plan),
    });
  }

  function draw(drawingContext: CanvasRenderingContext2D, state: FrameState) {
    const { progress, palette, glow } = state;
    if (mesh) drawMesh(drawingContext, palette, mesh, progress);
    drawStarField(drawingContext, palette, field, progress);
    drawOrbits(drawingContext, palette, orbit, progress);
    drawSatellites(drawingContext, palette, orbit, state);
    drawFigure(drawingContext, palette, glow, orbit, progress);
    drawEmptyRings(drawingContext, palette, orbit, plan.lit, plan.total, progress);
    drawProducts(drawingContext, palette, glow, orbit, plan.lit, currentProductIndex, progress);
    if (!state.entranceComplete) drawSignals(drawingContext, palette, glow, orbit, progress);
    drawLabels(drawingContext, palette, state.labelFont.canvasFont, labels, smooth((progress - 0.7) / 0.2));
    // Ask for more frames only while the satellites still drift.
    return !state.reduced && state.activeTime < DRIFT_DURATION_MILLISECONDS;
  }

  return mountCanvas(container, { draw, onResize: build });
}
