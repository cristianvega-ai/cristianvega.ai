export type Point = { x: number; y: number };

export const FULL_TURN_RADIANS = Math.PI * 2;

export function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function progress(elapsed: number, [start, end]: readonly [number, number]): number {
  return clamp((elapsed - start) / (end - start));
}

export function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/** Evaluate cubic Bezier into `out` (no allocation). */
export function cubicPoint(
  out: Point,
  t: number,
  start: Point,
  control1: Point,
  control2: Point,
  end: Point,
): Point {
  const oneMinusT = 1 - t;
  const tSquared = t * t;
  const oneMinusTSquared = oneMinusT * oneMinusT;
  const oneMinusTCubed = oneMinusTSquared * oneMinusT;
  const tCubed = tSquared * t;
  out.x =
    oneMinusTCubed * start.x +
    3 * oneMinusTSquared * t * control1.x +
    3 * oneMinusT * tSquared * control2.x +
    tCubed * end.x;
  out.y =
    oneMinusTCubed * start.y +
    3 * oneMinusTSquared * t * control1.y +
    3 * oneMinusT * tSquared * control2.y +
    tCubed * end.y;
  return out;
}
