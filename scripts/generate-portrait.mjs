// Generates small portrait derivatives for the About profile strip
// (rendered at 132px desktop / 88px mobile — 2× retina = 264px).
//
// Output:
//   public/images/cristian-vega-portrait.webp
//   public/images/cristian-vega-portrait.avif
//
// Usage: node scripts/generate-portrait.mjs
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SRC = "public/images/cristian-vega.png";
const SIZE = 264; // 2× the 132px desktop display size
const WEBP = "public/images/cristian-vega-portrait.webp";
const AVIF = "public/images/cristian-vega-portrait.avif";

mkdirSync(dirname(WEBP), { recursive: true });

const base = sharp(SRC).resize(SIZE, SIZE, { fit: "cover", position: "attention" });

const [webpInfo, avifInfo] = await Promise.all([
  base.clone().webp({ quality: 82, effort: 6 }).toFile(WEBP),
  base.clone().avif({ quality: 55, effort: 6 }).toFile(AVIF)
]);

console.log(`wrote ${WEBP} — ${webpInfo.width}×${webpInfo.height}, ${webpInfo.size} bytes`);
console.log(`wrote ${AVIF} — ${avifInfo.width}×${avifInfo.height}, ${avifInfo.size} bytes`);
