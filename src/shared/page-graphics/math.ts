import { clamp, easeOutCubic, FULL_TURN_RADIANS } from "../motion/easing.ts";

// One import point for the page graphics. The shared easing helpers live in
// `../motion/easing.ts`, so this file only adds what they lack.
export { clamp, easeOutCubic };
export const TAU = FULL_TURN_RADIANS;

/** Ease from 0 to 1 with no jump at either end. */
export function smooth(value: number): number {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** A fixed pseudo-random value in [0, 1) for an index, so every layout sows the same picture. */
export function unit(index: number): number {
  const value = Math.sin(index * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}
