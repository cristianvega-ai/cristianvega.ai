import { LYRA, LYRA_LINKS } from "../../lyra/constellation.ts";
import { entranceProgress, stagger } from "../../motion/clock.ts";
import { around, labelBounds, placeLabel, type PlacedLabel, type Rect, type Segment } from "../labels.ts";
import { FIGURE_INSET, reportFigureLeft } from "../inset.ts";
import { layoutLyra, type LyraPoint } from "../lyra.ts";
import { drawMesh, makeMesh, type Mesh } from "../mesh.ts";
import { drawComet, drawEdge, drawLabel, drawNode, drawStarField, drawVegaBloom, makeRoute, makeStarField, type FieldStar, type Route } from "../marks.ts";
import { easeOutCubic, smooth, TAU } from "../math.ts";
import { mountCanvas, type CanvasHandle, type FrameState } from "../mount.ts";

// Missing star: Lyra with one star absent. A dashed empty ring marks the gap, and dashed
// ghost links run into it. A slow pulse searches the gap a few times, then the picture rests.

/** The star that is missing: delta. */
export const MISSING = 3;
/** When each pulse starts, in milliseconds: the first at 2.9 s, then every 8 s. */
export const PULSE_STARTS = [2900, 10900, 18900, 26900] as const;
export const PULSE_MS = 2600;
/** The picture rests at this time. The last pulse ends before it. */
export const REST_MS = 30_500;
const RING_RADIUS = 7;
/** The resting alpha of the empty ring. It must read at once, over the mesh and the lattice. */
const RING_ALPHA = 0.95;
const DASH = [2.5, 4];
const NO_DASH: number[] = [];

export interface MissingLayout {
  /** True for a band, where the figure turns a quarter turn. */
  wide: boolean;
  pad: number;
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
    pad: wide ? FIGURE_INSET : 56,
    rotate: wide ? -Math.PI / 2 : 0,
    showNames: height > 300,
    reach: Math.min(58, Math.min(width, height) * 0.2),
  };
}

/**
 * Place the star names. Each takes the side of its star that no link crosses, clear of the other stars,
 * the empty ring, and the box edge. Vega always has its name, and the others only when the box is tall.
 */
export function placeLabels(bounds: Rect, stars: readonly LyraPoint[], showNames: boolean, widthsCssPx: readonly number[], lineCssPx?: number): PlacedLabel[] {
  const segments: Segment[] = LYRA_LINKS.map(([a, b]) => ({ ax: stars[a].x, ay: stars[a].y, bx: stars[b].x, by: stars[b].y }));
  const avoid: Rect[] = stars.map((star, i) => around(star.x, star.y, i === MISSING ? RING_RADIUS + 5 : 9));
  const placed: PlacedLabel[] = [];
  for (let i = 0; i < stars.length; i++) {
    const name = stars[i].name;
    if (name && (i === 0 || showNames)) placed.push(placeLabel(name, stars[i].x, stars[i].y, { widthCssPx: widthsCssPx[i], lineCssPx, bounds, segments, avoid, gap: stars[i].vega ? 14 : 12 }));
  }
  return placed;
}

/**
 * Fit the figure and place its names. When Vega finds no clear side, as in a narrow column, the figure
 * moves left by the room that its name needs, and the names are placed again.
 */
export function layoutMissing(width: number, height: number, layout: MissingLayout, bounds: Rect, widthsCssPx: readonly number[], lineCssPx?: number, out: LyraPoint[] = []) {
  let stars = layoutLyra(width, height, { pad: layout.pad, rotate: layout.rotate, out });
  let labels = placeLabels(bounds, stars, layout.showNames, widthsCssPx, lineCssPx);
  if (labels[0] && !labels[0].clear) {
    stars = layoutLyra(width - widthsCssPx[0] - 24, height, { pad: layout.pad, rotate: layout.rotate, out });
    labels = placeLabels(bounds, stars, layout.showNames, widthsCssPx, lineCssPx);
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
  function build(s: FrameState) {
    const layout = missingLayout(s.width, s.height);
    reach = layout.reach;
    reportFigureLeft(container, s.width, s.height);
    const bounds = labelBounds(container, s.width, s.height);
    const widthsCssPx = LYRA.map((star) => star.name ? s.labelFont.widthCssPx(star.name) : 0);
    const placed = layoutMissing(s.width, s.height, layout, bounds, widthsCssPx, s.labelFont.lineCssPx, stars);
    stars = placed.stars;
    labels = placed.labels;
    field = makeStarField(s.width, s.height, Math.round((s.width * s.height) / 8000), 3);
    mesh = makeMesh(s.width, s.height, 3);
    bright.length = 0;
    for (const i of [5, 4, 2, 0]) bright.push(stars[i]);
    comet = makeRoute(bright);
  }

  function draw(ctx: CanvasRenderingContext2D, s: FrameState) {
    // The entrance clock is in real milliseconds here, because the picture rests at 30.5 s and not at 2.3 s.
    const p = s.reduced ? 1 : entranceProgress(s.elapsed);
    const pal = s.palette;
    const gap = stars[MISSING];
    ctx.lineCap = "round";
    if (mesh) drawMesh(ctx, pal, mesh, p);
    drawStarField(ctx, pal, field, p);

    for (let i = 0; i < LYRA_LINKS.length; i++) {
      const [a, b] = LYRA_LINKS[i];
      const t = stagger(p, 0.1 + i * 0.07, 0.22);
      if (a === MISSING || b === MISSING) {
        // The figure runs on into the gap: dashed and dim.
        ctx.setLineDash(DASH);
        drawEdge(ctx, pal, stars[a].x, stars[a].y, stars[b].x, stars[b].y, t, false, 0.3);
        ctx.setLineDash(NO_DASH);
      } else {
        drawEdge(ctx, pal, stars[a].x, stars[a].y, stars[b].x, stars[b].y, t, i < 2, 0.4);
      }
    }
    for (let i = 0; i < stars.length; i++) {
      if (i === MISSING) continue;
      drawNode(ctx, pal, s.glow, stars[i].x, stars[i].y, i ? 2 : 2.6, stagger(p, 0.05 + i * 0.06, 0.14), i === 0 || i === 4 || i === 5, 0.95, i === 0);
    }

    // The empty ring.
    ctx.strokeStyle = pal.meta;
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = RING_ALPHA * smooth(stagger(p, 0.5, 0.25));
    ctx.setLineDash(DASH);
    ctx.beginPath();
    ctx.arc(gap.x, gap.y, RING_RADIUS, 0, TAU);
    ctx.stroke();
    ctx.setLineDash(NO_DASH);
    ctx.globalAlpha = 1;

    if (p < 1 && comet) {
      drawComet(ctx, pal, s.glow, comet, stagger(p, 0.36, 0.5), 70);
      drawVegaBloom(ctx, s.glow, stars[0].x, stars[0].y, smooth((p - 0.62) / 0.22) * (1 - smooth((p - 0.84) / 0.16)));
    }

    // A slow search of the gap. Reduced motion shows none.
    if (!s.reduced) {
      for (let k = 0; k < PULSE_STARTS.length; k++) {
        const u = (s.elapsed - PULSE_STARTS[k]) / PULSE_MS;
        if (u <= 0 || u >= 1) continue;
        const fade = 1 - u;
        ctx.strokeStyle = pal.sky;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.5 * fade;
        ctx.beginPath();
        ctx.arc(gap.x, gap.y, RING_RADIUS + easeOutCubic(u) * reach, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 0.25 * fade;
        ctx.beginPath();
        ctx.arc(gap.x, gap.y, RING_RADIUS + easeOutCubic(Math.max(0, u - 0.18)) * reach, 0, TAU);
        ctx.stroke();
        const start = u * TAU * 1.25;
        ctx.globalAlpha = 0.9 * Math.sin(Math.PI * u);
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(gap.x, gap.y, 13, start, start + 1);
        ctx.stroke();
        ctx.globalAlpha = 0.5 * Math.sin(Math.PI * u);
        ctx.beginPath();
        ctx.arc(gap.x, gap.y, RING_RADIUS, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    const label = smooth((p - 0.7) / 0.2);
    for (let i = 0; i < labels.length; i++) drawLabel(ctx, pal, s.labelFont.canvasFont, labels[i].text, labels[i].x, labels[i].y, labels[i].align, label);
  }

  return mountCanvas(container, { draw, onResize: build, duration: REST_MS });
}
