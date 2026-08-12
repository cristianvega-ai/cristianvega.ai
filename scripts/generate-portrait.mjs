// Generates image derivatives from the committed portrait master.
//
// Output:
//   public/images/cristian-vega-portrait.webp   (About strip, 264px)
//   public/images/cristian-vega-portrait.avif
//   public/images/cristian-vega-og.jpg           (Open Graph / Twitter, 1200×630)
//
// Usage: node scripts/generate-portrait.mjs
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SRC = "public/images/cristian-vega.png";
const SIZE = 264; // 2× the 132px desktop display size
const WEBP = "public/images/cristian-vega-portrait.webp";
const AVIF = "public/images/cristian-vega-portrait.avif";

// summary_large_image / LinkedIn-Facebook share card. The master is 800×800;
// letterbox it on the brand ink field so scrapers do not centre-crop the head.
const OG_W = 1200;
const OG_H = 630;
const OG = "public/images/cristian-vega-og.jpg";
const INK = { r: 0x14, g: 0x18, b: 0x1f };

mkdirSync(dirname(WEBP), { recursive: true });

const portraitBase = sharp(SRC).resize(SIZE, SIZE, { fit: "cover", position: "attention" });

const [webpInfo, avifInfo] = await Promise.all([
  portraitBase.clone().webp({ quality: 82, effort: 6 }).toFile(WEBP),
  portraitBase.clone().avif({ quality: 55, effort: 6 }).toFile(AVIF),
]);

console.log(`wrote ${WEBP} — ${webpInfo.width}×${webpInfo.height}, ${webpInfo.size} bytes`);
console.log(`wrote ${AVIF} — ${avifInfo.width}×${avifInfo.height}, ${avifInfo.size} bytes`);

const ogPortrait = await sharp(SRC)
  .resize(OG_H, OG_H, { fit: "cover", position: "attention" })
  .jpeg({ quality: 90, mozjpeg: true })
  .toBuffer();

const ogInfo = await sharp({
  create: {
    width: OG_W,
    height: OG_H,
    channels: 3,
    background: INK,
  },
})
  .composite([{ input: ogPortrait, left: 0, top: 0 }])
  .jpeg({ quality: 85, mozjpeg: true })
  .toFile(OG);

console.log(`wrote ${OG} — ${ogInfo.width}×${ogInfo.height}, ${ogInfo.size} bytes`);
