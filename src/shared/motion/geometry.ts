// Points and curves in the plane of a drawing.

export type Point = { x: number; y: number };

export const FULL_TURN_RADIANS = Math.PI * 2;

/** Evaluate cubic Bezier into `outputPoint` (no allocation). */
export function cubicPoint(
  outputPoint: Point,
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
  outputPoint.x =
    oneMinusTCubed * start.x +
    3 * oneMinusTSquared * t * control1.x +
    3 * oneMinusT * tSquared * control2.x +
    tCubed * end.x;
  outputPoint.y =
    oneMinusTCubed * start.y +
    3 * oneMinusTSquared * t * control1.y +
    3 * oneMinusT * tSquared * control2.y +
    tCubed * end.y;
  return outputPoint;
}
