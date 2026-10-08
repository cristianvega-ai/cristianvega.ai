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

const SOURCE_IMAGE_PATH = "public/favicon.svg";
const ICON_SIZE = 180; // the size iOS requests for rel="apple-touch-icon"
const BACKGROUND_COLOR = "#14181F"; // --ink, the mark's own plate colour
const OUTPUT_IMAGE_PATH = "public/images/apple-touch-icon.png";

mkdirSync(dirname(OUTPUT_IMAGE_PATH), { recursive: true });

// The mark is authored on a 32px canvas; raise the render density so the
// vector rasterizes at the output size instead of being upscaled.
const rasterDensity = Math.round((72 * ICON_SIZE) / 32);

const iconInformation = await sharp(readFileSync(SOURCE_IMAGE_PATH), { density: rasterDensity })
  .resize(ICON_SIZE, ICON_SIZE, { fit: "contain", background: BACKGROUND_COLOR })
  .flatten({ background: BACKGROUND_COLOR })
  .png({ compressionLevel: 9 })
  .toFile(OUTPUT_IMAGE_PATH);

console.log(`wrote ${OUTPUT_IMAGE_PATH} — ${iconInformation.width}×${iconInformation.height}, ${iconInformation.size} bytes`);
