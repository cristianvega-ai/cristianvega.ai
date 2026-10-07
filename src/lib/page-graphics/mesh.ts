import { clamp, easeOutCubic, smooth, TAU, unit } from "./math.ts";
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
  const cols = Math.max(1, Math.ceil(width / cell));
  const rows = Math.max(1, Math.ceil(height / cell));
  const slot = new Int16Array(cols * rows).fill(-1);
  const xs = new Float32Array(cols * rows);
  const ys = new Float32Array(cols * rows);
  const radius = new Float32Array(cols * rows);
  const hot = new Uint8Array(cols * rows);
  let count = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const key = (row * cols + col) * 6 + seed * 1000;
      if (unit(key) < EMPTY) continue;
      slot[row * cols + col] = count;
      xs[count] = clamp((col + 0.15 + unit(key + 1) * 0.7) * cell, 0, width);
      ys[count] = clamp((row + 0.15 + unit(key + 2) * 0.7) * cell, 0, height);
      radius[count] = 0.7 + unit(key + 3) * 0.7;
      hot[count] = unit(key + 4) > 0.9 ? 1 : 0;
      count++;
    }
  }
  const links = new Uint16Array(cols * rows * 8);
  let linkCount = 0;
  let diagonalFrom = 0;
  // Two passes keep the straight links first and the fainter diagonal arcs last.
  for (let pass = 0; pass < 2; pass++) {
    if (pass) diagonalFrom = linkCount;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const from = slot[row * cols + col];
        if (from < 0) continue;
        for (let s = pass ? FIRST_DIAGONAL : 0; s < (pass ? STEPS.length : FIRST_DIAGONAL); s++) {
          const c = col + STEPS[s][0];
          const r = row + STEPS[s][1];
          if (c < 0 || c >= cols || r >= rows) continue;
          const to = slot[r * cols + c];
          if (to < 0 || unit((row * cols + col) * 6 + 5 + s * 17 + seed * 1000) > CHANCE[s]) continue;
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
export function drawMesh(ctx: CanvasRenderingContext2D, palette: Palette, mesh: Mesh, progress: number, strength = 1): void {
  const fade = smooth(progress / 0.35) * strength;
  if (fade <= 0) return;
  ctx.lineCap = "round";
  ctx.lineWidth = 0.6;
  ctx.strokeStyle = palette.meta;
  for (let pass = 0; pass < 2; pass++) {
    ctx.globalAlpha = (pass ? DIAGONAL_ALPHA : EDGE_ALPHA) * fade;
    ctx.beginPath();
    for (let i = pass ? mesh.diagonalFrom : 0; i < (pass ? mesh.linkCount : mesh.diagonalFrom); i++) {
      const a = mesh.links[i * 2];
      const b = mesh.links[i * 2 + 1];
      const t = easeOutCubic(clamp((progress - 0.04 - (i / mesh.linkCount) * 0.4) / 0.3));
      if (t <= 0) continue;
      ctx.moveTo(mesh.xs[a], mesh.ys[a]);
      ctx.lineTo(mesh.xs[a] + (mesh.xs[b] - mesh.xs[a]) * t, mesh.ys[a] + (mesh.ys[b] - mesh.ys[a]) * t);
    }
    ctx.stroke();
  }
  for (let pass = 0; pass < 2; pass++) {
    ctx.fillStyle = pass ? palette.sky : palette.meta;
    ctx.globalAlpha = (pass ? HOT_ALPHA : NODE_ALPHA) * fade;
    ctx.beginPath();
    for (let i = 0; i < mesh.count; i++) {
      if (mesh.hot[i] !== pass) continue;
      const r = mesh.radius[i] * (pass ? 1.3 : 1);
      ctx.moveTo(mesh.xs[i] + r, mesh.ys[i]);
      ctx.arc(mesh.xs[i], mesh.ys[i], r, 0, TAU);
    }
    ctx.fill();
  }
  ctx.globalAlpha = 1;
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
  const ctx = layer.getContext("2d");
  if (!ctx) return null;
  ctx.scale(ratio, ratio);
  ctx.strokeStyle = palette.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = GRID_PITCH / 2; x < width; x += GRID_PITCH) {
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, height);
  }
  for (let y = GRID_PITCH / 2; y < height; y += GRID_PITCH) {
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(width, Math.round(y) + 0.5);
  }
  ctx.stroke();
  ctx.globalCompositeOperation = "destination-in";
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // A unit radial gradient, stretched to the ellipse of the box.
  ctx.translate(layer.width / 2, layer.height / 2);
  ctx.scale(layer.width / 2, layer.height / 2);
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  gradient.addColorStop(0, "rgb(0 0 0)");
  gradient.addColorStop(0.3, "rgb(0 0 0)");
  gradient.addColorStop(0.6, "rgb(0 0 0 / 0.42)");
  gradient.addColorStop(0.94, "rgb(0 0 0 / 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(-1, -1, 2, 2);
  return layer;
}
