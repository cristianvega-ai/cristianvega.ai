// Shares from 0 to 1, and the curves that ease them.

export function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function easeOutCubic(progress: number): number {
  return 1 - (1 - progress) ** 3;
}

/** Ease from 0 to 1 with no jump at either end. */
export function smooth(value: number): number {
  const clamped = clamp(value);
  return clamped * clamped * (3 - 2 * clamped);
}

/** Rise smoothly from 0 to 1 over the rise span, then fall smoothly back to 0 over the fall span. */
export function riseAndFall(value: number, riseStart: number, riseSpan: number, fallStart: number, fallSpan: number): number {
  return smooth((value - riseStart) / riseSpan) * (1 - smooth((value - fallStart) / fallSpan));
}

export function interpolate(from: number, to: number, share: number): number {
  return from + (to - from) * share;
}
