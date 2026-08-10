// Rasterizes the site mark into the iOS home-screen icon.
// iOS applies its own rounded mask, so the source SVG is flattened onto the
// mark's own background colour and shipped as a full-bleed 180×180 square.
//
// Output:
//   public/images/apple-touch-icon.png
//
// Usage: node scripts/generate-touch-icon.mjs
import sharp from "sharp";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

const SRC = "public/favicon.svg";
const SIZE = 180; // the size iOS requests for rel="apple-touch-icon"
const BACKGROUND = "#14181F"; // --ink, the mark's own plate colour
const OUT = "public/images/apple-touch-icon.png";

mkdirSync(dirname(OUT), { recursive: true });

// The mark is authored on a 32px canvas; raise the render density so the
// vector rasterizes at the output size instead of being upscaled.
const density = Math.round((72 * SIZE) / 32);

const info = await sharp(readFileSync(SRC), { density })
  .resize(SIZE, SIZE, { fit: "contain", background: BACKGROUND })
  .flatten({ background: BACKGROUND })
  .png({ compressionLevel: 9 })
  .toFile(OUT);

console.log(`wrote ${OUT} — ${info.width}×${info.height}, ${info.size} bytes`);
