import { LYRA_LINKS } from "../../lyra/constellation.ts";
import { entranceProgress, stagger } from "../../motion/clock.ts";
import { drawComet, makeRoute, type Route } from "../../motion/comets.ts";
import { easeOutCubic, smooth } from "../../motion/easing.ts";
import { FULL_TURN_RADIANS } from "../../motion/geometry.ts";
import { drawEdge, drawNode, drawVegaBloom, entranceBloom } from "../../motion/marks.ts";
import type { Palette } from "../../motion/palette.ts";
import { drawStarField, makeStarField, type FieldStar } from "../../motion/star-field.ts";
import { labelBounds, reportFigureLeft } from "../container.ts";
import { drawLabels, type PlacedLabel } from "../labels.ts";
import { starNameWidths, type LyraPoint } from "../lyra.ts";
import { drawMesh, makeMesh, type Mesh } from "../mesh.ts";
import { mountCanvas, type CanvasHandle, type FrameState } from "../mount.ts";
import { layoutMissing, MISSING, missingLayout, RING_RADIUS } from "./404-layout.ts";

// Missing star: Lyra with one star absent. A dashed empty ring marks the gap, and dashed
// ghost links run into it. A slow pulse searches the gap a few times, then the picture rests.

/** When each pulse starts, in milliseconds: the first at 2.9 s, then every 8 s. */
const PULSE_STARTS = [2900, 10900, 18900, 26900] as const;
const PULSE_DURATION_MILLISECONDS = 2600;
/** The picture rests at this time. The last pulse ends before it. */
const REST_TIME_MILLISECONDS = 30_500;
/** The resting alpha of the empty ring. It must read at once, over the mesh and the lattice. */
const RING_ALPHA = 0.95;
const DASH = [2.5, 4];
const NO_DASH: number[] = [];

/** The figure: the links, dashed and dim where they run into the gap, and every star but the missing one. */
function drawFigure(
  drawingContext: CanvasRenderingContext2D,
  palette: Palette,
  glow: HTMLCanvasElement,
  stars: readonly LyraPoint[],
  progress: number,
): void {
  for (let i = 0; i < LYRA_LINKS.length; i++) {
    const [a, b] = LYRA_LINKS[i];
    const edgeProgress = stagger(progress, 0.1 + i * 0.07, 0.22);
    if (a === MISSING || b === MISSING) {
      // The figure runs on into the gap: dashed and dim.
      drawingContext.setLineDash(DASH);
      drawEdge(
        drawingContext,
        palette,
        stars[a].x,
        stars[a].y,
        stars[b].x,
        stars[b].y,
        edgeProgress,
        false,
        0.3,
      );
      drawingContext.setLineDash(NO_DASH);
    } else {
      drawEdge(
        drawingContext,
        palette,
        stars[a].x,
        stars[a].y,
        stars[b].x,
        stars[b].y,
        edgeProgress,
        i < 2,
        0.4,
      );
    }
  }
  for (let i = 0; i < stars.length; i++) {
    if (i === MISSING) continue;
    drawNode(
      drawingContext,
      palette,
      glow,
      stars[i].x,
      stars[i].y,
      i ? 2 : 2.6,
      stagger(progress, 0.05 + i * 0.06, 0.14),
      i === 0 || i === 4 || i === 5,
      0.95,
      i === 0,
    );
  }
}

/** The dashed empty ring where the missing star should be. */
function drawEmptyRing(drawingContext: CanvasRenderingContext2D, palette: Palette, gap: LyraPoint, progress: number): void {
  drawingContext.strokeStyle = palette.metadata;
  drawingContext.lineWidth = 1.2;
  drawingContext.globalAlpha = RING_ALPHA * smooth(stagger(progress, 0.5, 0.25));
  drawingContext.setLineDash(DASH);
  drawingContext.beginPath();
  drawingContext.arc(gap.x, gap.y, RING_RADIUS, 0, FULL_TURN_RADIANS);
  drawingContext.stroke();
  drawingContext.setLineDash(NO_DASH);
  drawingContext.globalAlpha = 1;
}

/** A slow search of the gap: each pulse spreads two rings and sweeps an arc round the gap. */
function drawSearchPulses(
  drawingContext: CanvasRenderingContext2D,
  palette: Palette,
  gap: LyraPoint,
  reach: number,
  elapsed: number,
): void {
  for (let pulseIndex = 0; pulseIndex < PULSE_STARTS.length; pulseIndex++) {
    const pulseProgress = (elapsed - PULSE_STARTS[pulseIndex]) / PULSE_DURATION_MILLISECONDS;
    if (pulseProgress <= 0 || pulseProgress >= 1) continue;
    const fade = 1 - pulseProgress;
    drawingContext.strokeStyle = palette.sky;
    drawingContext.lineWidth = 1;
    drawingContext.globalAlpha = 0.5 * fade;
    drawingContext.beginPath();
    drawingContext.arc(
      gap.x,
      gap.y,
      RING_RADIUS + easeOutCubic(pulseProgress) * reach,
      0,
      FULL_TURN_RADIANS,
    );
    drawingContext.stroke();
    drawingContext.globalAlpha = 0.25 * fade;
    drawingContext.beginPath();
    drawingContext.arc(
      gap.x,
      gap.y,
      RING_RADIUS + easeOutCubic(Math.max(0, pulseProgress - 0.18)) * reach,
      0,
      FULL_TURN_RADIANS,
    );
    drawingContext.stroke();
    const start = pulseProgress * FULL_TURN_RADIANS * 1.25;
    drawingContext.globalAlpha = 0.9 * Math.sin(Math.PI * pulseProgress);
    drawingContext.lineWidth = 1.4;
    drawingContext.beginPath();
    drawingContext.arc(gap.x, gap.y, 13, start, start + 1);
    drawingContext.stroke();
    drawingContext.globalAlpha = 0.5 * Math.sin(Math.PI * pulseProgress);
    drawingContext.beginPath();
    drawingContext.arc(gap.x, gap.y, RING_RADIUS, 0, FULL_TURN_RADIANS);
    drawingContext.stroke();
    drawingContext.globalAlpha = 1;
  }
}

export function mountNotFound(container: HTMLElement): CanvasHandle | null {
  let reach = 40;
  let field: FieldStar[] = [];
  let mesh: Mesh | undefined;
  let labels: PlacedLabel[] = [];
  let comet: Route | undefined;
  let stars: LyraPoint[] = [];
  const bright: LyraPoint[] = [];

  // Rebuild the layout from the measured box. Nothing here depends on a CSS breakpoint.
  function build(state: FrameState) {
    const layout = missingLayout(state.width, state.height);
    reach = layout.reach;
    reportFigureLeft(container);
    const bounds = labelBounds(container, state.width, state.height);
    const widthsInPixels = starNameWidths(state.labelFont);
    const placed = layoutMissing(state.width, state.height, layout, bounds, widthsInPixels, state.labelFont.lineHeightInPixels, stars);
    stars = placed.stars;
    labels = placed.labels;
    field = makeStarField(state.width, state.height, Math.round((state.width * state.height) / 8000), 3);
    mesh = makeMesh(state.width, state.height, 3);
    bright.length = 0;
    for (const i of [5, 4, 2, 0]) bright.push(stars[i]);
    comet = makeRoute(bright);
  }

  function draw(drawingContext: CanvasRenderingContext2D, state: FrameState) {
    // The entrance clock is in real milliseconds here, because the picture rests at 30.5 s and not at 2.3 s.
    const progress = state.reduced ? 1 : entranceProgress(state.elapsed);
    const palette = state.palette;
    drawingContext.lineCap = "round";
    if (mesh) drawMesh(drawingContext, palette, mesh, progress);
    drawStarField(drawingContext, palette, field, progress);
    drawFigure(drawingContext, palette, state.glow, stars, progress);
    drawEmptyRing(drawingContext, palette, stars[MISSING], progress);
    if (progress < 1 && comet) {
      drawComet(drawingContext, palette, state.glow, comet, stagger(progress, 0.36, 0.5), 70);
      drawVegaBloom(drawingContext, state.glow, stars[0].x, stars[0].y, entranceBloom(progress));
    }
    // Reduced motion shows no search.
    if (!state.reduced) drawSearchPulses(drawingContext, palette, stars[MISSING], reach, state.elapsed);
    drawLabels(drawingContext, palette, state.labelFont.canvasFont, labels, smooth((progress - 0.7) / 0.2));
  }

  return mountCanvas(container, { draw, onResize: build, duration: REST_TIME_MILLISECONDS });
}
