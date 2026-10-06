import { clamp } from "./math.ts";

/** The entrance length in milliseconds. It matches the homepage globe. */
export const DURATION = 2300;

/** The globe's entrance curve: a little fast at the start, and exactly 1 at the end. */
export function entranceProgress(elapsed: number): number {
  return 1 - (1 - clamp(elapsed / DURATION)) ** 1.3;
}

/** A staggered share of the entrance: 0 before `start`, 1 after `start + span`. */
export function stagger(progress: number, start: number, span: number): number {
  return clamp((progress - start) / span);
}
