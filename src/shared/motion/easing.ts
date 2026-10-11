// Shares from 0 to 1, and the curves that ease them.

export function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

export function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/** Ease from 0 to 1 with no jump at either end. */
export function smooth(value: number): number {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
}

/** Rise smoothly from 0 to 1 over the rise span, then fall smoothly back to 0 over the fall span. */
export function riseAndFall(value: number, riseStart: number, riseSpan: number, fallStart: number, fallSpan: number): number {
  return smooth((value - riseStart) / riseSpan) * (1 - smooth((value - fallStart) / fallSpan));
}

export function interpolate(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}
