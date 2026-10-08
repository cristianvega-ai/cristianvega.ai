// Generates the Open Graph share card from the committed portrait master.
// The master lives in assets/, not public/, so the static copy does not
// publish the 800×800 source.
//
// Output:
//   public/images/cristian-vega-social-preview.jpg           (Open Graph / Twitter, 1200×630)
//
// Usage: node scripts/generate-social-preview.mjs
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SOURCE_IMAGE_PATH = "assets/cristian-vega.png";

// summary_large_image / LinkedIn-Facebook share card. The master is 800×800;
// letterbox it on the brand ink field so scrapers do not centre-crop the head.
const SOCIAL_PREVIEW_WIDTH = 1200;
const SOCIAL_PREVIEW_HEIGHT = 630;
const OUTPUT_IMAGE_PATH = "public/images/cristian-vega-social-preview.jpg";
const BACKGROUND_COLOR = { r: 0x14, g: 0x18, b: 0x1f };

mkdirSync(dirname(OUTPUT_IMAGE_PATH), { recursive: true });

const portraitBuffer = await sharp(SOURCE_IMAGE_PATH)
  .resize(SOCIAL_PREVIEW_HEIGHT, SOCIAL_PREVIEW_HEIGHT, { fit: "cover", position: "attention" })
  .jpeg({ quality: 90, mozjpeg: true })
  .toBuffer();

const previewInformation = await sharp({
  create: {
    width: SOCIAL_PREVIEW_WIDTH,
    height: SOCIAL_PREVIEW_HEIGHT,
    channels: 3,
    background: BACKGROUND_COLOR,
  },
})
  .composite([{ input: portraitBuffer, left: 0, top: 0 }])
  .jpeg({ quality: 85, mozjpeg: true })
  .toFile(OUTPUT_IMAGE_PATH);

console.log(`wrote ${OUTPUT_IMAGE_PATH} — ${previewInformation.width}×${previewInformation.height}, ${previewInformation.size} bytes`);
