import { LYRA_LINKS } from "../../lyra/constellation.ts";
import { makeRoute, type Route } from "../../canvas/comets.ts";
import { cubicPoint, FULL_TURN_RADIANS, type Point } from "../../canvas/geometry.ts";
import { unit } from "../../canvas/random.ts";
import { FIGURE_INSET } from "../inset.ts";
import { around, placeLabel, type PlacedLabel, type Rectangle, type Segment } from "../labels.ts";
import { boundsOf, layoutLyra, lyraLinkSegments, type LyraPoint } from "../lyra.ts";

// The layout of the Writing graphic, "Reading field". It has no DOM and no canvas,
// so a test can run it. The caller gives the box, the article identifiers, and the label texts.
// Every place comes from the identifiers, so a reload keeps the picture.

/** Field stars that link the articles to the sky. They carry no label. */
const FILLER_STAR_COUNT = 26;
/** Samples on the bent stretch of a route, from an article to the nearest Lyra star. */
export const CURVE_STEPS = 12;
/** The clear distance a label keeps from a star centre, in CSS pixels. */
const STAR_CLEARANCE = 10;

interface FieldPoint {
  x: number;
  y: number;
  /** The radius of a filler star. Articles draw their own mark. */
  radius: number;
  /** The base brightness of a filler star, from 0 to 1. */
  alpha: number;
  article: boolean;
}

interface FieldLink {
  from: number;
  to: number;
  /** 1 when an article is one end of the link, else 0. */
  weight: number;
}

interface FieldInput {
  articleIdentifiers: readonly string[];
  labels: readonly string[];
  /** Measured text widths in CSS pixels, in label order. */
  labelWidthsInPixels: readonly number[];
  /** Measured text widths in CSS pixels, in Lyra star order. */
  starWidthsInPixels: readonly number[];
  /** The height of one label line in CSS pixels, from the label font. */
  lineHeightInPixels: number;
  /** The box in CSS pixels. Text must not enter the part of the slot outside it. */
  width: number;
  height: number;
  /** Where labels may sit, in the same pixels. */
  bounds: Rectangle;
}

export interface FieldLayout {
  stars: LyraPoint[];
  /** Articles first, in list order, then the filler stars. */
  points: FieldPoint[];
  links: FieldLink[];
  articleLabels: PlacedLabel[];
  /** One entry for each Lyra star. Null when no clear place exists. */
  starLabels: (PlacedLabel | null)[];
}

/** A stable value in [0, 1) from a text and a salt (FNV-1a, then a scramble). */
function hashUnit(text: string, salt: number): number {
  let hash = 2166136261 ^ salt;
  for (let characterIndex = 0; characterIndex < text.length; characterIndex++) {
    hash ^= text.charCodeAt(characterIndex);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 2246822519);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 3266489917);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296;
}

/** The shortest path, as node numbers, from `start` to node 0 over an undirected edge list. */
export function pathToVega(start: number, edges: readonly (readonly [number, number])[], count: number): number[] {
  const previous = new Array<number>(count).fill(-1);
  const queue = [0];
  previous[0] = 0;
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head];
    for (const [fromNode, toNode] of edges) {
      const neighbor = fromNode === node ? toNode : toNode === node ? fromNode : -1;
      if (neighbor >= 0 && previous[neighbor] < 0) {
        previous[neighbor] = node;
        queue.push(neighbor);
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
  margins: { left: number; right: number; top: number; bottom: number },
  width: number,
  height: number,
): void {
  for (let pass = 0; pass < 60; pass++) {
    for (let firstIndex = 0; firstIndex < list.length; firstIndex++) {
      for (let secondIndex = firstIndex + 1; secondIndex < list.length; secondIndex++) {
        const deltaX = list[secondIndex].x - list[firstIndex].x;
        const deltaY = list[secondIndex].y - list[firstIndex].y;
        const distance = Math.hypot(deltaX, deltaY) || 0.01;
        if (distance < minimum) {
          const pushShare = (minimum - distance) / 2 / distance;
          list[firstIndex].x -= deltaX * pushShare;
          list[firstIndex].y -= deltaY * pushShare;
          list[secondIndex].x += deltaX * pushShare;
          list[secondIndex].y += deltaY * pushShare;
        }
      }
      const point = list[firstIndex];
      const zoneShareX = (point.x - center.x) / zone.x;
      const zoneShareY = (point.y - center.y) / zone.y;
      const zoneDistance = Math.hypot(zoneShareX, zoneShareY) || 0.01;
      if (zoneDistance < 1) {
        point.x = center.x + (zoneShareX / zoneDistance) * zone.x;
        point.y = center.y + (zoneShareY / zoneDistance) * zone.y;
      }
      point.x = Math.min(width - margins.right, Math.max(margins.left, point.x));
      point.y = Math.min(height - margins.bottom, Math.max(margins.top, point.y));
    }
  }
}

export function buildField({ articleIdentifiers, labels, labelWidthsInPixels, starWidthsInPixels, lineHeightInPixels, width, height, bounds }: FieldInput): FieldLayout {
  const count = articleIdentifiers.length;
  const tall = height > width * 1.05;
  const labelWidth = labelWidthsInPixels.reduce((widest, measuredWidth) => Math.max(widest, measuredWidth), 0);
  const centerX = width / 2 + (tall ? 8 : 0);
  const centerY = height / 2;

  // The Lyra figure sits in the middle. Upright in a tall box, on its side in a wide one.
  const stars = layoutLyra(Math.min(width * 0.42, 220), Math.min(height * (tall ? 0.3 : 0.4), 260), { padding: 2, rotation: tall ? 0 : Math.PI / 2 });
  const { x0: minimumX, x1: maximumX, y0: minimumY, y1: maximumY } = boundsOf(stars);
  const shiftX = centerX - (minimumX + maximumX) / 2;
  const shiftY = centerY - (minimumY + maximumY) / 2;
  for (const star of stars) {
    star.x += shiftX;
    star.y += shiftY;
  }
  const zone = { x: (maximumX - minimumX) / 2 + 26, y: (maximumY - minimumY) / 2 + 26 };

  // Articles: the angle slots follow the hash order, so the identifiers place the stars and the ring stays even.
  const margins = { left: labelWidth + 26, right: labelWidth + 26, top: Math.max(40, FIGURE_INSET), bottom: Math.max(40, FIGURE_INSET) };
  const radiusX = (width - margins.left - margins.right) / 2;
  const radiusY = (height - margins.top - margins.bottom) / 2;
  const order = articleIdentifiers.map((identifier, articleIndex) => ({ articleIndex, angle: hashUnit(identifier, 1) })).sort((first, second) => first.angle - second.angle);
  const points: FieldPoint[] = new Array(count);
  order.forEach(({ articleIndex }, rank) => {
    const identifier = articleIdentifiers[articleIndex];
    const angle = -Math.PI / 2 + ((rank + 0.5 + (hashUnit(identifier, 3) - 0.5) * 0.5) / count) * FULL_TURN_RADIANS + 0.35;
    const reach = 0.66 + 0.34 * hashUnit(identifier, 2);
    points[articleIndex] = { x: centerX + Math.cos(angle) * radiusX * reach * 1.1, y: centerY + Math.sin(angle) * radiusY * reach, radius: 0, alpha: 1, article: true };
  });
  spread(points, { x: centerX, y: centerY }, zone, Math.min(width, height) * 0.2 + 10, margins, width, height);

  // Filler stars fill the gaps, clear of the Lyra zone and of every point placed before.
  for (let fillerIndex = 0; fillerIndex < FILLER_STAR_COUNT; fillerIndex++) {
    const x = FIGURE_INSET + unit(fillerIndex * 5 + 9) * (width - 2 * FIGURE_INSET);
    const y = FIGURE_INSET + unit(fillerIndex * 5 + 10) * (height - 2 * FIGURE_INSET);
    const zoneShareX = (x - centerX) / zone.x;
    const zoneShareY = (y - centerY) / zone.y;
    if (zoneShareX * zoneShareX + zoneShareY * zoneShareY < 1.1) continue;
    if (points.some((point) => Math.hypot(point.x - x, point.y - y) < 30)) continue;
    points.push({ x, y, radius: 0.6 + unit(fillerIndex * 5 + 11) * 0.7, alpha: 0.5 + 0.3 * Math.sin(unit(fillerIndex * 5 + 12) * FULL_TURN_RADIANS), article: false });
  }

  // Synapses: each point links to its two nearest neighbours, once for each pair.
  const links: FieldLink[] = [];
  const seen = new Set<number>();
  const maximumDistance = Math.max(width, height) * 0.24;
  points.forEach((point, pointIndex) => {
    const ranked = points
      .map((other, otherIndex) => ({ otherIndex, distance: Math.hypot(other.x - point.x, other.y - point.y) }))
      .filter((entry) => entry.otherIndex !== pointIndex && entry.distance < maximumDistance)
      .sort((first, second) => first.distance - second.distance)
      .slice(0, 2);
    for (const { otherIndex } of ranked) {
      const key = pointIndex < otherIndex ? pointIndex * 4096 + otherIndex : otherIndex * 4096 + pointIndex;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ from: pointIndex, to: otherIndex, weight: point.article || points[otherIndex].article ? 1 : 0 });
    }
  });

  // Labels. Each takes the first side of its star that no synapse, figure link, or earlier label crosses.
  const synapses: Segment[] = links.map((link) => ({ startX: points[link.from].x, startY: points[link.from].y, endX: points[link.to].x, endY: points[link.to].y }));
  const figure = lyraLinkSegments(stars);
  const segments = [...synapses, ...figure];
  const taken: Rectangle[] = [];
  for (const star of stars) taken.push(around(star.x, star.y, STAR_CLEARANCE));
  for (let articleIndex = 0; articleIndex < count; articleIndex++) taken.push(around(points[articleIndex].x, points[articleIndex].y, STAR_CLEARANCE));

  const articleLabels = labels.map((text, articleIndex) => {
    const { x, y } = points[articleIndex];
    const placeOnRight = x >= centerX;
    return placeLabel(text, x, y, { widthInPixels: labelWidthsInPixels[articleIndex], lineHeightInPixels, bounds, segments, avoid: taken, gap: 13, prefer: placeOnRight ? ["right", "left", "above", "below"] : ["left", "right", "above", "below"] });
  });

  const starLabels = stars.map((star, starIndex) => {
    if (!star.name) return null;
    // A star name keeps clear of the figure links. A faint synapse under it only breaks a tie, and the halo cuts it out.
    const label = placeLabel(star.name, star.x, star.y, { widthInPixels: starWidthsInPixels[starIndex], lineHeightInPixels, bounds, segments: figure, soft: synapses, avoid: taken, gap: 14, lift: star.vega ? -10 : 0 });
    return label.clear ? label : null;
  });

  return { stars, points, links, articleLabels, starLabels };
}

/**
 * One route for each article: a bent path to the nearest Lyra star, then along the figure to Vega.
 * The first CURVE_STEPS points are the bent path. The rest are Lyra stars, with Vega last.
 */
export function buildArticleRoutes(layout: FieldLayout, articleCount: number): Route[] {
  const { stars, points } = layout;
  const scratch: Point = { x: 0, y: 0 };
  const start: Point = { x: 0, y: 0 };
  const control: Point = { x: 0, y: 0 };
  const end: Point = { x: 0, y: 0 };
  return Array.from({ length: articleCount }, (_, articleIndex) => {
    const articlePoint = points[articleIndex];
    let nearestStarIndex = 1;
    let nearestDistance = Infinity;
    for (let starIndex = 1; starIndex < stars.length; starIndex++) {
      const distance = Math.hypot(stars[starIndex].x - articlePoint.x, stars[starIndex].y - articlePoint.y);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestStarIndex = starIndex;
      }
    }
    const target = stars[nearestStarIndex];
    const bend = (articleIndex % 2 ? 1 : -1) * 0.16;
    start.x = articlePoint.x;
    start.y = articlePoint.y;
    end.x = target.x;
    end.y = target.y;
    control.x = (articlePoint.x + target.x) / 2 - (target.y - articlePoint.y) * bend;
    control.y = (articlePoint.y + target.y) / 2 + (target.x - articlePoint.x) * bend;
    const route: Point[] = [];
    for (let sampleIndex = 0; sampleIndex < CURVE_STEPS; sampleIndex++) {
      cubicPoint(scratch, sampleIndex / CURVE_STEPS, start, control, control, end);
      route.push({ x: scratch.x, y: scratch.y });
    }
    for (const starIndex of pathToVega(nearestStarIndex, LYRA_LINKS, stars.length)) route.push(stars[starIndex]);
    return makeRoute(route);
  });
}

/** The articles whose comets run during the entrance: up to four, spread over the list, each once. */
export function entranceArticleIndices(articleCount: number): number[] {
  return [0, 3, 5, articleCount - 1].filter(
    (articleIndex, listIndex, indices) => articleIndex < articleCount && indices.indexOf(articleIndex) === listIndex,
  );
}
