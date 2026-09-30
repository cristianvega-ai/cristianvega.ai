import { LYRA_LINKS } from "../../lyra/constellation.ts";
import { around, labelWidth as labelWidthOf, placeLabel, type LabelAlign, type PlacedLabel, type Rect, type Segment } from "../labels.ts";
import { FIGURE_INSET } from "../inset.ts";
import { layoutLyra, type LyraPoint } from "../lyra.ts";
import { TAU, unit } from "../math.ts";

// The layout of the Writing graphic, "Reading field". It has no DOM and no canvas,
// so a test can run it. The caller gives the box, the post ids, and the label texts.
// Every place comes from the ids, so a reload keeps the picture.

/** Field stars that link the posts to the sky. They carry no label. */
const FILLER = 26;
/** The clear distance a label keeps from a star centre, in CSS pixels. */
const STAR_CLEARANCE = 10;
export type { LabelAlign, Rect };
export { rectsOverlap as overlaps } from "../labels.ts";

export interface FieldPoint {
  x: number;
  y: number;
  /** The radius of a filler star. Posts draw their own mark. */
  radius: number;
  /** The base brightness of a filler star, from 0 to 1. */
  alpha: number;
  post: boolean;
}

export interface FieldLink {
  from: number;
  to: number;
  /** 1 when a post is one end of the link, else 0. */
  weight: number;
}

/** A label with its place. It is a placed label from labels.ts. */
export type FieldLabel = PlacedLabel;

export interface FieldInput {
  ids: readonly string[];
  labels: readonly string[];
  /** The box in CSS pixels. Text must not enter the part of the slot outside it. */
  w: number;
  h: number;
  /** Where labels may sit, in the same pixels. It defaults to the box. */
  bounds?: Rect;
}

export interface FieldLayout {
  stars: LyraPoint[];
  /** Posts first, in list order, then the filler stars. */
  points: FieldPoint[];
  links: FieldLink[];
  postLabels: FieldLabel[];
  /** One entry for each Lyra star. Null when no clear place exists. */
  starLabels: (FieldLabel | null)[];
}

/** A stable value in [0, 1) from a text and a salt (FNV-1a, then a scramble). */
export function hashUnit(text: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489917);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** The shortest path, as node numbers, from `start` to node 0 over an undirected edge list. */
export function pathToVega(start: number, edges: readonly (readonly [number, number])[], count: number): number[] {
  const previous = new Array<number>(count).fill(-1);
  const queue = [0];
  previous[0] = 0;
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head];
    for (const [a, b] of edges) {
      const next = a === node ? b : b === node ? a : -1;
      if (next >= 0 && previous[next] < 0) {
        previous[next] = node;
        queue.push(next);
      }
    }
  }
  const path = [start];
  while (path[path.length - 1] !== 0) path.push(previous[path[path.length - 1]]);
  return path;
}

/** Push points apart and out of the Lyra zone, in a fixed number of passes, so the result is stable. */
function spread(
  list: FieldPoint[],
  center: { x: number; y: number },
  zone: { x: number; y: number },
  minimum: number,
  margins: { l: number; r: number; t: number; b: number },
  w: number,
  h: number,
): void {
  for (let pass = 0; pass < 60; pass++) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const dx = list[j].x - list[i].x;
        const dy = list[j].y - list[i].y;
        const d = Math.hypot(dx, dy) || 0.01;
        if (d < minimum) {
          const k = (minimum - d) / 2 / d;
          list[i].x -= dx * k;
          list[i].y -= dy * k;
          list[j].x += dx * k;
          list[j].y += dy * k;
        }
      }
      const p = list[i];
      const nx = (p.x - center.x) / zone.x;
      const ny = (p.y - center.y) / zone.y;
      const nd = Math.hypot(nx, ny) || 0.01;
      if (nd < 1) {
        p.x = center.x + (nx / nd) * zone.x;
        p.y = center.y + (ny / nd) * zone.y;
      }
      p.x = Math.min(w - margins.r, Math.max(margins.l, p.x));
      p.y = Math.min(h - margins.b, Math.max(margins.t, p.y));
    }
  }
}

export function buildField({ ids, labels, w, h, bounds = { x0: 0, y0: 0, x1: w, y1: h } }: FieldInput): FieldLayout {
  const count = ids.length;
  const tall = h > w * 1.05;
  const labelWidth = labels.reduce((widest, text) => Math.max(widest, labelWidthOf(text)), 0);
  const cx = w / 2 + (tall ? 8 : 0);
  const cy = h / 2;

  // The Lyra figure sits in the middle. Upright in a tall box, on its side in a wide one.
  const stars = layoutLyra(Math.min(w * 0.42, 220), Math.min(h * (tall ? 0.3 : 0.4), 260), { pad: 2, rotate: tall ? 0 : Math.PI / 2 });
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const star of stars) {
    minX = Math.min(minX, star.x);
    maxX = Math.max(maxX, star.x);
    minY = Math.min(minY, star.y);
    maxY = Math.max(maxY, star.y);
  }
  const shiftX = cx - (minX + maxX) / 2;
  const shiftY = cy - (minY + maxY) / 2;
  for (const star of stars) {
    star.x += shiftX;
    star.y += shiftY;
  }
  const zone = { x: (maxX - minX) / 2 + 26, y: (maxY - minY) / 2 + 26 };

  // Posts: the angle slots follow the hash order, so the ids place the stars and the ring stays even.
  const margins = { l: labelWidth + 26, r: labelWidth + 26, t: Math.max(40, FIGURE_INSET), b: Math.max(40, FIGURE_INSET) };
  const rx = (w - margins.l - margins.r) / 2;
  const ry = (h - margins.t - margins.b) / 2;
  const order = ids.map((id, index) => ({ index, angle: hashUnit(id, 1) })).sort((a, b) => a.angle - b.angle);
  const points: FieldPoint[] = new Array(count);
  order.forEach(({ index }, rank) => {
    const id = ids[index];
    const angle = -Math.PI / 2 + ((rank + 0.5 + (hashUnit(id, 3) - 0.5) * 0.5) / count) * TAU + 0.35;
    const reach = 0.66 + 0.34 * hashUnit(id, 2);
    points[index] = { x: cx + Math.cos(angle) * rx * reach * 1.1, y: cy + Math.sin(angle) * ry * reach, radius: 0, alpha: 1, post: true };
  });
  spread(points, { x: cx, y: cy }, zone, Math.min(w, h) * 0.2 + 10, margins, w, h);

  // Filler stars fill the gaps, clear of the Lyra zone and of every point placed before.
  for (let i = 0; i < FILLER; i++) {
    const x = FIGURE_INSET + unit(i * 5 + 9) * (w - 2 * FIGURE_INSET);
    const y = FIGURE_INSET + unit(i * 5 + 10) * (h - 2 * FIGURE_INSET);
    const nx = (x - cx) / zone.x;
    const ny = (y - cy) / zone.y;
    if (nx * nx + ny * ny < 1.1) continue;
    if (points.some((p) => Math.hypot(p.x - x, p.y - y) < 30)) continue;
    points.push({ x, y, radius: 0.6 + unit(i * 5 + 11) * 0.7, alpha: 0.5 + 0.3 * Math.sin(unit(i * 5 + 12) * TAU), post: false });
  }

  // Synapses: each point links to its two nearest neighbours, once for each pair.
  const links: FieldLink[] = [];
  const seen = new Set<number>();
  const maxDistance = Math.max(w, h) * 0.24;
  points.forEach((p, i) => {
    const ranked = points
      .map((q, j) => ({ j, d: Math.hypot(q.x - p.x, q.y - p.y) }))
      .filter((entry) => entry.j !== i && entry.d < maxDistance)
      .sort((a, b) => a.d - b.d)
      .slice(0, 2);
    for (const { j } of ranked) {
      const key = i < j ? i * 4096 + j : j * 4096 + i;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ from: i, to: j, weight: p.post || points[j].post ? 1 : 0 });
    }
  });

  // Labels. Each takes the first side of its star that no synapse, figure link, or earlier label crosses.
  const synapses: Segment[] = links.map((link) => ({ ax: points[link.from].x, ay: points[link.from].y, bx: points[link.to].x, by: points[link.to].y }));
  const figure: Segment[] = LYRA_LINKS.map(([a, b]) => ({ ax: stars[a].x, ay: stars[a].y, bx: stars[b].x, by: stars[b].y }));
  const segments = [...synapses, ...figure];
  const taken: Rect[] = [];
  for (const star of stars) taken.push(around(star.x, star.y, STAR_CLEARANCE));
  for (let i = 0; i < count; i++) taken.push(around(points[i].x, points[i].y, STAR_CLEARANCE));

  const postLabels = labels.map((text, i) => {
    const { x, y } = points[i];
    const out = x >= cx;
    return placeLabel(text, x, y, { bounds, segments, avoid: taken, gap: 13, prefer: out ? ["right", "left", "above", "below"] : ["left", "right", "above", "below"] });
  });

  const starLabels = stars.map((star) => {
    if (!star.name) return null;
    // A star name keeps clear of the figure links. A faint synapse under it only breaks a tie, and the halo cuts it out.
    const label = placeLabel(star.name, star.x, star.y, { bounds, segments: figure, soft: synapses, avoid: taken, gap: 14, lift: star.vega ? -10 : 0 });
    return label.clear ? label : null;
  });

  return { stars, points, links, postLabels, starLabels };
}

/** The Lyra links as a list a route search can read. */
export const LYRA_EDGES: readonly (readonly [number, number])[] = LYRA_LINKS;
