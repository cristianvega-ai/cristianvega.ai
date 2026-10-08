import { clamp, easeOutCubic, smooth, FULL_TURN_RADIANS, unit } from "./math.ts";
import type { Palette } from "../motion/palette.ts";

// The neural mesh: a sparse field of faint nodes and synapses behind a page graphic, so each page
// reads as a slice of the same neural sky as the homepage. It is fixed by a seed, it draws in during the
// entrance, and it is quiet, so the main figure stays the strongest mark. Build it on resize.

/** The distance between mesh cells, in CSS pixels. Every page graphic uses this one density. */
const CELL = 96;
/** Share of cells that hold no node. */
const EMPTY = 0.22;
/** A synapse to a right, lower, and diagonal neighbour is drawn with these chances. */
const CHANCE = [0.5, 0.5, 0.16, 0.12] as const;
const STEPS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [-1, 1],
] as const;
/** The diagonal arcs are the extra neighbour arcs. They start at this step and draw fainter. */
const FIRST_DIAGONAL = 2;
const EDGE_ALPHA = 0.07;
const DIAGONAL_ALPHA = 0.035;
const NODE_ALPHA = 0.2;
const HOT_ALPHA = 0.36;

export interface Mesh {
  xs: Float32Array;
  ys: Float32Array;
  /** The radius of each node. */
  radius: Float32Array;
  /** 1 for the few nodes that carry sky light, else 0. */
  hot: Uint8Array;
  /** Pairs of node numbers: from, to, from, to, and so on. */
  links: Uint16Array;
  count: number;
  linkCount: number;
  /** Links from this number on are diagonal arcs. Straight neighbour links come first. */
  diagonalFrom: number;
}

/** Build a mesh for the supplied width and height. The same box and seed give the same mesh. */
export function makeMesh(width: number, height: number, seed = 0, cell = CELL): Mesh {
  const columns = Math.max(1, Math.ceil(width / cell));
  const rows = Math.max(1, Math.ceil(height / cell));
  const slot = new Int16Array(columns * rows).fill(-1);
  const xs = new Float32Array(columns * rows);
  const ys = new Float32Array(columns * rows);
  const radius = new Float32Array(columns * rows);
  const hot = new Uint8Array(columns * rows);
  let count = 0;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const key = (row * columns + column) * 6 + seed * 1000;
      if (unit(key) < EMPTY) continue;
      slot[row * columns + column] = count;
      xs[count] = clamp((column + 0.15 + unit(key + 1) * 0.7) * cell, 0, width);
      ys[count] = clamp((row + 0.15 + unit(key + 2) * 0.7) * cell, 0, height);
      radius[count] = 0.7 + unit(key + 3) * 0.7;
      hot[count] = unit(key + 4) > 0.9 ? 1 : 0;
      count++;
    }
  }
  const links = new Uint16Array(columns * rows * 8);
  let linkCount = 0;
  let diagonalFrom = 0;
  // Two passes keep the straight links first and the fainter diagonal arcs last.
  for (let pass = 0; pass < 2; pass++) {
    if (pass) diagonalFrom = linkCount;
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const from = slot[row * columns + column];
        if (from < 0) continue;
        for (let step = pass ? FIRST_DIAGONAL : 0; step < (pass ? STEPS.length : FIRST_DIAGONAL); step++) {
          const neighborColumn = column + STEPS[step][0];
          const r = row + STEPS[step][1];
          if (neighborColumn < 0 || neighborColumn >= columns || r >= rows) continue;
          const to = slot[r * columns + neighborColumn];
          if (to < 0 || unit((row * columns + column) * 6 + 5 + step * 17 + seed * 1000) > CHANCE[step]) continue;
          links[linkCount * 2] = from;
          links[linkCount * 2 + 1] = to;
          linkCount++;
        }
      }
    }
  }
  return { xs: xs.subarray(0, count), ys: ys.subarray(0, count), radius: radius.subarray(0, count), hot: hot.subarray(0, count), links, count, linkCount, diagonalFrom };
}

/** Draw the mesh. `progress` 0..1 is the entrance: synapses draw in one after another, then the nodes settle. */
export function drawMesh(drawingContext: CanvasRenderingContext2D, palette: Palette, mesh: Mesh, progress: number, strength = 1): void {
  const fade = smooth(progress / 0.35) * strength;
  if (fade <= 0) return;
  drawingContext.lineCap = "round";
  drawingContext.lineWidth = 0.6;
  drawingContext.strokeStyle = palette.metadata;
  for (let pass = 0; pass < 2; pass++) {
    drawingContext.globalAlpha = (pass ? DIAGONAL_ALPHA : EDGE_ALPHA) * fade;
    drawingContext.beginPath();
    for (let i = pass ? mesh.diagonalFrom : 0; i < (pass ? mesh.linkCount : mesh.diagonalFrom); i++) {
      const a = mesh.links[i * 2];
      const b = mesh.links[i * 2 + 1];
      const t = easeOutCubic(clamp((progress - 0.04 - (i / mesh.linkCount) * 0.4) / 0.3));
      if (t <= 0) continue;
      drawingContext.moveTo(mesh.xs[a], mesh.ys[a]);
      drawingContext.lineTo(mesh.xs[a] + (mesh.xs[b] - mesh.xs[a]) * t, mesh.ys[a] + (mesh.ys[b] - mesh.ys[a]) * t);
    }
    drawingContext.stroke();
  }
  for (let pass = 0; pass < 2; pass++) {
    drawingContext.fillStyle = pass ? palette.sky : palette.metadata;
    drawingContext.globalAlpha = (pass ? HOT_ALPHA : NODE_ALPHA) * fade;
    drawingContext.beginPath();
    for (let i = 0; i < mesh.count; i++) {
      if (mesh.hot[i] !== pass) continue;
      const r = mesh.radius[i] * (pass ? 1.3 : 1);
      drawingContext.moveTo(mesh.xs[i] + r, mesh.ys[i]);
      drawingContext.arc(mesh.xs[i], mesh.ys[i], r, 0, FULL_TURN_RADIANS);
    }
    drawingContext.fill();
  }
  drawingContext.globalAlpha = 1;
}

/** The pitch of the site grid, in CSS pixels. It matches the homepage and the CSS grid on the other pages. */
const GRID_PITCH = 40;

/**
 * A layer of the site's faint blueprint grid with the same elliptical fade as the CSS grid. Build it on
 * resize and draw it with drawImage. Null when a canvas cannot be made.
 */
export function makeGridLayer(width: number, height: number, ratio: number, palette: Palette): HTMLCanvasElement | null {
  const layer = document.createElement("canvas");
  layer.width = Math.max(1, Math.round(width * ratio));
  layer.height = Math.max(1, Math.round(height * ratio));
  const drawingContext = layer.getContext("2d");
  if (!drawingContext) return null;
  drawingContext.scale(ratio, ratio);
  drawingContext.strokeStyle = palette.grid;
  drawingContext.lineWidth = 1;
  drawingContext.beginPath();
  for (let x = GRID_PITCH / 2; x < width; x += GRID_PITCH) {
    drawingContext.moveTo(Math.round(x) + 0.5, 0);
    drawingContext.lineTo(Math.round(x) + 0.5, height);
  }
  for (let y = GRID_PITCH / 2; y < height; y += GRID_PITCH) {
    drawingContext.moveTo(0, Math.round(y) + 0.5);
    drawingContext.lineTo(width, Math.round(y) + 0.5);
  }
  drawingContext.stroke();
  drawingContext.globalCompositeOperation = "destination-in";
  drawingContext.setTransform(1, 0, 0, 1, 0, 0);
  // A unit radial gradient, stretched to the ellipse of the box.
  drawingContext.translate(layer.width / 2, layer.height / 2);
  drawingContext.scale(layer.width / 2, layer.height / 2);
  const gradient = drawingContext.createRadialGradient(0, 0, 0, 0, 0, 1);
  gradient.addColorStop(0, "rgb(0 0 0)");
  gradient.addColorStop(0.3, "rgb(0 0 0)");
  gradient.addColorStop(0.6, "rgb(0 0 0 / 0.42)");
  gradient.addColorStop(0.94, "rgb(0 0 0 / 0)");
  drawingContext.fillStyle = gradient;
  drawingContext.fillRect(-1, -1, 2, 2);
  return layer;
}
