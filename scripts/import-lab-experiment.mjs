// Import one Lab experiment from a local experiment folder into
// assets/lab/<experiment>/. The manifest assets/lab/<experiment>/import.json
// names the source files relative to that folder, so no machine path is
// tracked.
//
//   npm run import:lab-experiment -- <experiment> <experiment folder>
//
// For each result it:
// - copies the listed scene files into scenes/<result>/, saves the entry as
//   index.html, and skips operating-system files. Production forces trailing
//   slashes, so an entry such as Aether.html would redirect and break the
//   scene's relative links;
// - downloads the listed vendor files and rewrites their addresses, so no
//   scene calls a third-party host;
// - cuts its clip from the comparison video: one tile of the grid, trimmed
//   to the shared camera path, as an AV1 clip, an H.264 clip and a WebP
//   poster at 560 pixels wide. A group also gets a mosaic of every tile.
//
// It needs a local ffmpeg with libsvtav1 and libx264. sharp, a development
// dependency, reads the frame that locates the tiles.
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";

const run = promisify(execFile);
/** Twice the width a result tile takes on the experiment page. */
const CLIP_WIDTH = 560;
const MOSAIC_TILE_WIDTH = 286;
const MOSAIC_GAP = 4;
/** The rounded tile corners and the label bar stay out of the crop. */
const TILE_INSET = 8;
const SYSTEM_FILES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

const [experiment, sourceFolderArgument] = process.argv.slice(2);
if (!experiment || !sourceFolderArgument) {
  console.error("Usage: npm run import:lab-experiment -- <experiment> <experiment folder>");
  process.exit(1);
}

const sourceFolder = resolve(sourceFolderArgument);
const experimentFolder = resolve("assets", "lab", experiment);
const manifest = JSON.parse(await readFile(join(experimentFolder, "import.json"), "utf8"));

const isSystemFile = (path) => SYSTEM_FILES.has(basename(path)) || basename(path).startsWith("._");

async function importScene(result) {
  const from = join(sourceFolder, result.folder);
  const to = join(experimentFolder, "scenes", result.slug);
  await rm(to, { recursive: true, force: true });
  await mkdir(to, { recursive: true });
  for (const file of result.files) {
    const target = file === result.entry ? "index.html" : file;
    await cp(join(from, file), join(to, target), { recursive: true, filter: (path) => !isSystemFile(path) });
  }
  for (const vendorFile of result.vendor ?? []) {
    const response = await fetch(vendorFile.url);
    if (!response.ok) throw new Error(`${result.slug}: ${vendorFile.url} returned HTTP ${response.status}`);
    const target = join(to, vendorFile.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, Buffer.from(await response.arrayBuffer()));
  }
  if (result.rewrite?.length) {
    const entryPath = join(to, "index.html");
    let markup = await readFile(entryPath, "utf8");
    for (const [address, replacement] of result.rewrite) {
      if (!markup.includes(address)) throw new Error(`${result.slug}: the entry does not contain ${address}`);
      markup = markup.replaceAll(address, replacement);
    }
    await writeFile(entryPath, markup);
  }
  console.log(`scene: ${result.slug}`);
}

/**
 * Find the tile pictures in one frame of the comparison video. A column is
 * part of a tile when most of its pixels differ from the page ground. A row
 * belongs to a tile picture when most of its pixels inside the tile column
 * are far from the ground, which leaves out the darker label bar.
 */
async function findTiles(framePath, columns, rows) {
  const { data, info } = await sharp(framePath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (x, y) => (y * info.width + x) * 3;
  const ground = [data[at(10, 10)], data[at(10, 10) + 1], data[at(10, 10) + 2]];
  const distance = (x, y) => Math.abs(data[at(x, y)] - ground[0]) + Math.abs(data[at(x, y) + 1] - ground[1]) + Math.abs(data[at(x, y) + 2] - ground[2]);
  const ranges = (length, isFilled) => {
    const found = [];
    let start = -1;
    for (let index = 0; index <= length; index += 1) {
      const filled = index < length && isFilled(index);
      if (filled && start < 0) start = index;
      if (!filled && start >= 0) {
        if (index - start > length * 0.05) found.push([start, index - 1]);
        start = -1;
      }
    }
    return found;
  };
  const columnRanges = ranges(info.width, (x) => {
    let count = 0;
    for (let y = 0; y < info.height; y += 4) if (distance(x, y) > 18) count += 1;
    return count > (info.height / 4) * 0.3;
  });
  if (columnRanges.length !== columns) throw new Error(`found ${columnRanges.length} tile columns, expected ${columns}`);
  const [firstLeft, firstRight] = columnRanges[0];
  const rowRanges = ranges(info.height, (y) => {
    let count = 0;
    for (let x = firstLeft; x <= firstRight; x += 2) if (distance(x, y) > 60) count += 1;
    return count > ((firstRight - firstLeft) / 2) * 0.5;
  });
  if (rowRanges.length !== rows) throw new Error(`found ${rowRanges.length} tile rows, expected ${rows}`);
  const even = (value) => value - (value % 2);
  return rowRanges.flatMap(([top, bottom]) => columnRanges.map(([left, right]) => ({
    x: left + TILE_INSET,
    y: top + TILE_INSET,
    width: even(right - left + 1 - 2 * TILE_INSET),
    height: even(bottom - top + 1 - 2 * TILE_INSET),
  })));
}

async function encode(source, outputBase) {
  await run("ffmpeg", ["-v", "error", "-y", "-i", source, "-an", "-c:v", "libsvtav1", "-preset", "6", "-crf", "48", "-pix_fmt", "yuv420p", "-movflags", "+faststart", `${outputBase}.av1.mp4`]);
  await run("ffmpeg", ["-v", "error", "-y", "-i", source, "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "32", "-pix_fmt", "yuv420p", "-movflags", "+faststart", `${outputBase}.h264.mp4`]);
}

async function writePoster(source, posterPath, workFolder) {
  const framePath = join(workFolder, `${basename(posterPath, ".webp")}-poster.png`);
  await run("ffmpeg", ["-v", "error", "-y", "-i", source, "-frames:v", "1", framePath]);
  await sharp(framePath).webp({ quality: 80 }).toFile(posterPath);
}

async function importClips(results) {
  const { file, grid, trim } = manifest.video;
  const videoPath = join(sourceFolder, file);
  await stat(videoPath);
  const workFolder = await mkdtemp(join(tmpdir(), "lab-import-"));
  try {
    const framePath = join(workFolder, "frame.png");
    await run("ffmpeg", ["-v", "error", "-y", "-ss", String(trim.start + 4), "-i", videoPath, "-frames:v", "1", framePath]);
    const tiles = await findTiles(framePath, grid.columns, grid.rows);
    if (tiles.length !== results.length) throw new Error(`the video has ${tiles.length} tiles for ${results.length} results`);

    // One pass cuts every tile and the mosaic into high-quality intermediates.
    const mosaicTileHeight = Math.round((MOSAIC_TILE_WIDTH * tiles[0].height) / tiles[0].width / 2) * 2;
    const graph = [`[0:v]split=${tiles.length}${tiles.map((_, tileIndex) => `[s${tileIndex}]`).join("")}`];
    tiles.forEach((tile, tileIndex) => {
      graph.push(`[s${tileIndex}]crop=${tile.width}:${tile.height}:${tile.x}:${tile.y},scale=${CLIP_WIDTH}:-2:flags=lanczos,split[v${tileIndex}][m${tileIndex}]`);
      graph.push(`[m${tileIndex}]scale=${MOSAIC_TILE_WIDTH}:${mosaicTileHeight}:flags=lanczos[t${tileIndex}]`);
    });
    const layout = tiles.map((_, tileIndex) => `${(tileIndex % grid.columns) * (MOSAIC_TILE_WIDTH + MOSAIC_GAP)}_${Math.floor(tileIndex / grid.columns) * (mosaicTileHeight + MOSAIC_GAP)}`).join("|");
    graph.push(`${tiles.map((_, tileIndex) => `[t${tileIndex}]`).join("")}xstack=inputs=${tiles.length}:layout=${layout}:fill=white[mosaic]`);
    const intermediate = ["-an", "-c:v", "libx264", "-preset", "fast", "-crf", "16", "-pix_fmt", "yuv420p"];
    const names = [...results.map((result) => result.slug), "mosaic"];
    const outputs = names.flatMap((name, outputIndex) => ["-map", outputIndex < tiles.length ? `[v${outputIndex}]` : "[mosaic]", ...intermediate, join(workFolder, `${name}.mp4`)]);
    await run("ffmpeg", ["-v", "error", "-y", "-ss", String(trim.start), "-t", String(trim.end - trim.start), "-i", videoPath, "-filter_complex", graph.join(";"), ...outputs], { maxBuffer: 1 << 26 });

    const clipFolder = join(experimentFolder, "clips");
    const posterFolder = join(experimentFolder, "posters");
    await rm(clipFolder, { recursive: true, force: true });
    await rm(posterFolder, { recursive: true, force: true });
    await mkdir(clipFolder, { recursive: true });
    await mkdir(posterFolder, { recursive: true });
    for (const name of names) {
      const source = join(workFolder, `${name}.mp4`);
      await encode(source, join(clipFolder, name));
      await writePoster(source, join(posterFolder, `${name}.webp`), workFolder);
      console.log(`clip: ${name}`);
    }
  } finally {
    await rm(workFolder, { recursive: true, force: true });
  }
}

for (const result of manifest.results) await importScene(result);
await importClips(manifest.results);
console.log(`Imported ${experiment}: ${manifest.results.length} results.`);
