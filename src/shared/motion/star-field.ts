import { smooth } from "./easing.ts";
import { FULL_TURN_RADIANS } from "./geometry.ts";
import type { Palette } from "./palette.ts";
import { unit } from "./random.ts";

// The faint field stars behind the globe and the page graphics.

export interface FieldStar {
  x: number;
  y: number;
  radius: number;
  alpha: number;
}

/** Field stars fixed by a seed. Build them on resize. */
export function makeStarField(width: number, height: number, count: number, seed: number): FieldStar[] {
  const field: FieldStar[] = [];
  for (let i = 0; i < count; i++) {
    field.push({
      x: unit(i * 3 + seed) * width,
      y: unit(i * 3 + 1 + seed) * height,
      radius: 0.5 + unit(i * 3 + 2 + seed) * 0.8,
      alpha: 0.15 + unit(i * 7 + seed) * 0.35,
    });
  }
  return field;
}

export function drawStarField(
  drawingContext: CanvasRenderingContext2D,
  palette: Palette,
  field: readonly FieldStar[],
  progress: number,
): void {
  const fadeIn = smooth(progress / 0.5);
  drawingContext.fillStyle = palette.metadata;
  for (let i = 0; i < field.length; i++) {
    const star = field[i];
    drawingContext.globalAlpha = star.alpha * fadeIn;
    drawingContext.beginPath();
    drawingContext.arc(star.x, star.y, star.radius, 0, FULL_TURN_RADIANS);
    drawingContext.fill();
  }
  drawingContext.globalAlpha = 1;
}
