// Generates halftone dot data (positions + radii) for the canvas portrait.
// Each grid cell becomes a dot whose radius tracks how dark that cell is, so the
// face emerges from a field of ink dots. The home hero draws these on a <canvas>
// and animates them flying in — far smoother than animating 1000+ SVG nodes.
//
// Output: src/halftone-dots.json  ->  { w, h, dots: [[x, y, r], ...] }
// Usage:  node scripts/generate-halftone.mjs
import sharp from "sharp";
import { writeFileSync } from "node:fs";

const SRC = "public/images/cristian-vega.png";
const OUT = "src/halftone-dots.json";

const COLS = 58; // horizontal dot count (detail vs. count)
const CELL = 10; // grid units per cell
const MAX_R = (CELL / 2) * 0.72; // largest dot radius
const CONTRAST = 1.95; // push tones apart around mid-gray
const FLOOR = 0.44; // darkness below this draws no dot (drops the light background)
const GAMMA = 0.82; // radius response curve
const MIN_R = 0.36; // skip dots smaller than this
// Drop stray background dots in the upper corners (studio-backdrop speckle),
// keeping the centered head and the full-width shoulders below.
const CUT_ABOVE = 0.5;
const CUT_SIDE = 0.28;

const meta = await sharp(SRC).metadata();
const ROWS = Math.round((COLS * meta.height) / meta.width);

const { data, info } = await sharp(SRC)
  .grayscale()
  .resize(COLS, ROWS, { fit: "fill" })
  .raw()
  .toBuffer({ resolveWithObject: true });

const ch = info.channels;
const w = COLS * CELL;
const h = ROWS * CELL;
const dots = [];

for (let y = 0; y < ROWS; y++) {
  for (let x = 0; x < COLS; x++) {
    const nx = (x + 0.5) / COLS;
    const ny = (y + 0.5) / ROWS;
    if (ny < CUT_ABOVE && Math.abs(nx - 0.5) > CUT_SIDE) continue;

    const lum = data[(y * COLS + x) * ch] / 255;
    const adj = Math.min(1, Math.max(0, 0.5 + (lum - 0.5) * CONTRAST));
    const darkness = 1 - adj;
    if (darkness < FLOOR) continue;

    const norm = (darkness - FLOOR) / (1 - FLOOR);
    const r = MAX_R * Math.pow(norm, GAMMA);
    if (r < MIN_R) continue;

    dots.push([
      +((x + 0.5) * CELL).toFixed(1),
      +((y + 0.5) * CELL).toFixed(1),
      +r.toFixed(2),
    ]);
  }
}

writeFileSync(OUT, JSON.stringify({ w, h, dots }));
console.log(`wrote ${OUT} — ${dots.length} dots`);
