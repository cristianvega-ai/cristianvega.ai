import { LYRA, LYRA_LINKS } from "../../lyra/constellation.ts";
import { entranceProgress, stagger } from "../../motion/clock.ts";
import { around, labelBounds, placeLabel, type PlacedLabel, type Rectangle, type Segment } from "../labels.ts";
import { FIGURE_INSET, reportFigureLeft } from "../inset.ts";
import { layoutLyra, type LyraPoint } from "../lyra.ts";
import { drawMesh, makeMesh, type Mesh } from "../mesh.ts";
import { drawComet, drawEdge, drawLabel, drawNode, drawStarField, drawVegaBloom, makeRoute, makeStarField, type FieldStar, type Route } from "../marks.ts";
import { easeOutCubic, smooth, FULL_TURN_RADIANS } from "../math.ts";
import { mountCanvas, type CanvasHandle, type FrameState } from "../mount.ts";

// Missing star: Lyra with one star absent. A dashed empty ring marks the gap, and dashed
// ghost links run into it. A slow pulse searches the gap a few times, then the picture rests.

/** The star that is missing: delta. */
export const MISSING = 3;
/** When each pulse starts, in milliseconds: the first at 2.9 s, then every 8 s. */
export const PULSE_STARTS = [2900, 10900, 18900, 26900] as const;
export const PULSE_DURATION_MILLISECONDS = 2600;
/** The picture rests at this time. The last pulse ends before it. */
export const REST_TIME_MILLISECONDS = 30_500;
const RING_RADIUS = 7;
/** The resting alpha of the empty ring. It must read at once, over the mesh and the lattice. */
const RING_ALPHA = 0.95;
const DASH = [2.5, 4];
const NO_DASH: number[] = [];

export interface MissingLayout {
  /** True for a band, where the figure turns a quarter turn. */
  wide: boolean;
  padding: number;
  rotate: number;
  showNames: boolean;
  /** How far a pulse spreads beyond the ring, in CSS pixels. */
  reach: number;
}

/** The layout choices for a box, from its measured size. */
export function missingLayout(width: number, height: number): MissingLayout {
  const wide = width > height * 1.6;
  return {
    wide,
    padding: wide ? FIGURE_INSET : 56,
    rotate: wide ? -Math.PI / 2 : 0,
    showNames: height > 300,
    reach: Math.min(58, Math.min(width, height) * 0.2),
  };
}

/**
 * Place the star names. Each takes the side of its star that no link crosses, clear of the other stars,
 * the empty ring, and the box edge. Vega always has its name, and the others only when the box is tall.
 */
export function placeLabels(bounds: Rectangle, stars: readonly LyraPoint[], showNames: boolean, widthsInPixels: readonly number[], lineHeightInPixels?: number): PlacedLabel[] {
  const segments: Segment[] = LYRA_LINKS.map(([a, b]) => ({ ax: stars[a].x, ay: stars[a].y, bx: stars[b].x, by: stars[b].y }));
  const avoid: Rectangle[] = stars.map((star, i) => around(star.x, star.y, i === MISSING ? RING_RADIUS + 5 : 9));
  const placed: PlacedLabel[] = [];
  for (let i = 0; i < stars.length; i++) {
    const name = stars[i].name;
    if (name && (i === 0 || showNames)) placed.push(placeLabel(name, stars[i].x, stars[i].y, { widthInPixels: widthsInPixels[i], lineHeightInPixels, bounds, segments, avoid, gap: stars[i].vega ? 14 : 12 }));
  }
  return placed;
}

/**
 * Fit the figure and place its names. When Vega finds no clear side, as in a narrow column, the figure
 * moves left by the room that its name needs, and the names are placed again.
 */
export function layoutMissing(width: number, height: number, layout: MissingLayout, bounds: Rectangle, widthsInPixels: readonly number[], lineHeightInPixels?: number, outputStars: LyraPoint[] = []) {
  let stars = layoutLyra(width, height, { padding: layout.padding, rotate: layout.rotate, outputPoints: outputStars });
  let labels = placeLabels(bounds, stars, layout.showNames, widthsInPixels, lineHeightInPixels);
  if (labels[0] && !labels[0].clear) {
    stars = layoutLyra(width - widthsInPixels[0] - 24, height, { padding: layout.padding, rotate: layout.rotate, outputPoints: outputStars });
    labels = placeLabels(bounds, stars, layout.showNames, widthsInPixels, lineHeightInPixels);
  }
  return { stars, labels };
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
    reportFigureLeft(container, state.width, state.height);
    const bounds = labelBounds(container, state.width, state.height);
    const widthsInPixels = LYRA.map((star) => star.name ? state.labelFont.widthInPixels(star.name) : 0);
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
    const gap = stars[MISSING];
    drawingContext.lineCap = "round";
    if (mesh) drawMesh(drawingContext, palette, mesh, progress);
    drawStarField(drawingContext, palette, field, progress);

    for (let i = 0; i < LYRA_LINKS.length; i++) {
      const [a, b] = LYRA_LINKS[i];
      const t = stagger(progress, 0.1 + i * 0.07, 0.22);
      if (a === MISSING || b === MISSING) {
        // The figure runs on into the gap: dashed and dim.
        drawingContext.setLineDash(DASH);
        drawEdge(drawingContext, palette, stars[a].x, stars[a].y, stars[b].x, stars[b].y, t, false, 0.3);
        drawingContext.setLineDash(NO_DASH);
      } else {
        drawEdge(drawingContext, palette, stars[a].x, stars[a].y, stars[b].x, stars[b].y, t, i < 2, 0.4);
      }
    }
    for (let i = 0; i < stars.length; i++) {
      if (i === MISSING) continue;
      drawNode(drawingContext, palette, state.glow, stars[i].x, stars[i].y, i ? 2 : 2.6, stagger(progress, 0.05 + i * 0.06, 0.14), i === 0 || i === 4 || i === 5, 0.95, i === 0);
    }

    // The empty ring.
    drawingContext.strokeStyle = palette.metadata;
    drawingContext.lineWidth = 1.2;
    drawingContext.globalAlpha = RING_ALPHA * smooth(stagger(progress, 0.5, 0.25));
    drawingContext.setLineDash(DASH);
    drawingContext.beginPath();
    drawingContext.arc(gap.x, gap.y, RING_RADIUS, 0, FULL_TURN_RADIANS);
    drawingContext.stroke();
    drawingContext.setLineDash(NO_DASH);
    drawingContext.globalAlpha = 1;

    if (progress < 1 && comet) {
      drawComet(drawingContext, palette, state.glow, comet, stagger(progress, 0.36, 0.5), 70);
      drawVegaBloom(drawingContext, state.glow, stars[0].x, stars[0].y, smooth((progress - 0.62) / 0.22) * (1 - smooth((progress - 0.84) / 0.16)));
    }

    // A slow search of the gap. Reduced motion shows none.
    if (!state.reduced) {
      for (let k = 0; k < PULSE_STARTS.length; k++) {
        const u = (state.elapsed - PULSE_STARTS[k]) / PULSE_DURATION_MILLISECONDS;
        if (u <= 0 || u >= 1) continue;
        const fade = 1 - u;
        drawingContext.strokeStyle = palette.sky;
        drawingContext.lineWidth = 1;
        drawingContext.globalAlpha = 0.5 * fade;
        drawingContext.beginPath();
        drawingContext.arc(gap.x, gap.y, RING_RADIUS + easeOutCubic(u) * reach, 0, FULL_TURN_RADIANS);
        drawingContext.stroke();
        drawingContext.globalAlpha = 0.25 * fade;
        drawingContext.beginPath();
        drawingContext.arc(gap.x, gap.y, RING_RADIUS + easeOutCubic(Math.max(0, u - 0.18)) * reach, 0, FULL_TURN_RADIANS);
        drawingContext.stroke();
        const start = u * FULL_TURN_RADIANS * 1.25;
        drawingContext.globalAlpha = 0.9 * Math.sin(Math.PI * u);
        drawingContext.lineWidth = 1.4;
        drawingContext.beginPath();
        drawingContext.arc(gap.x, gap.y, 13, start, start + 1);
        drawingContext.stroke();
        drawingContext.globalAlpha = 0.5 * Math.sin(Math.PI * u);
        drawingContext.beginPath();
        drawingContext.arc(gap.x, gap.y, RING_RADIUS, 0, FULL_TURN_RADIANS);
        drawingContext.stroke();
        drawingContext.globalAlpha = 1;
      }
    }

    const label = smooth((progress - 0.7) / 0.2);
    for (let i = 0; i < labels.length; i++) drawLabel(drawingContext, palette, state.labelFont.canvasFont, labels[i].text, labels[i].x, labels[i].y, labels[i].align, label);
  }

  return mountCanvas(container, { draw, onResize: build, duration: REST_TIME_MILLISECONDS });
}
