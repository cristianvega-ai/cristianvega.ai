import { LYRA } from "../lyra/constellation.ts";

export interface LyraPoint {
  x: number;
  y: number;
  mag: number;
  name: string | undefined;
  /** True for Vega, the brightest star of the figure. */
  vega: boolean;
}

/** The longest side of the figure on any canvas, in CSS pixels. A tall canvas gets a margin, not a bigger figure. */
export const LYRA_MAX_SIZE = 280;

export interface LyraLayoutOptions {
  /** Empty space kept round the figure, in CSS pixels. */
  pad?: number;
  /** Turn the figure by this angle, in radians, before it is fitted. */
  rotate?: number;
  /** Cap the longest side of the figure at this size. */
  maxSize?: number;
  /** Reuse this array to avoid an allocation. */
  out?: LyraPoint[];
}

/**
 * Fit the Lyra figure into a w by h box with one uniform scale. The proportions stay the same on every
 * canvas. The figure never grows past `maxSize`, so it sits centred in a tall or wide box with space round it.
 * Call it on resize, not per frame.
 */
export function layoutLyra(
  w: number,
  h: number,
  { pad = 16, rotate = 0, maxSize = LYRA_MAX_SIZE, out = [] }: LyraLayoutOptions = {},
): LyraPoint[] {
  const cos = Math.cos(rotate);
  const sin = Math.sin(rotate);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const star of LYRA) {
    const rx = star.x * cos - star.y * sin;
    const ry = star.x * sin + star.y * cos;
    minX = Math.min(minX, rx);
    maxX = Math.max(maxX, rx);
    minY = Math.min(minY, ry);
    maxY = Math.max(maxY, ry);
  }
  const scale = Math.min((w - pad * 2) / (maxX - minX || 1), (h - pad * 2) / (maxY - minY || 1), maxSize / Math.max(maxX - minX, maxY - minY, 1e-9));
  const offsetX = (w - (maxX - minX) * scale) / 2 - minX * scale;
  const offsetY = (h - (maxY - minY) * scale) / 2 - minY * scale;
  LYRA.forEach((star, i) => {
    const point = out[i] ?? (out[i] = { x: 0, y: 0, mag: 0, name: undefined, vega: false });
    point.x = (star.x * cos - star.y * sin) * scale + offsetX;
    point.y = (star.x * sin + star.y * cos) * scale + offsetY;
    point.mag = star.mag;
    point.name = star.name;
    point.vega = i === 0;
  });
  return out;
}
