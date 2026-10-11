import { clamp, easeOutCubic, smooth } from "../canvas/easing.ts";
import { FULL_TURN_RADIANS } from "../canvas/geometry.ts";
import type { Palette } from "../canvas/palette.ts";
import { unit } from "../canvas/random.ts";

// The neural mesh: a sparse field of faint nodes and synapses behind a page graphic, so each page
// reads as a slice of the same neural sky as the homepage. It is fixed by a seed, it draws in during the
// entrance, and it is quiet, so the main figure stays the strongest mark. Build it on resize.

/** The distance between mesh cells, in CSS pixels. Every page graphic uses this one density. */
const CELL_SIZE = 96;
/** Share of cells that hold no node. */
const EMPTY_CELL_SHARE = 0.22;
/** A synapse to a right, lower, and diagonal neighbour is drawn with these chances. */
const LINK_CHANCES = [0.5, 0.5, 0.16, 0.12] as const;
const NEIGHBOR_STEPS = [
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
  nodeX: Float32Array;
  nodeY: Float32Array;
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
export function makeMesh(width: number, height: number, seed: number): Mesh {
  const columns = Math.max(1, Math.ceil(width / CELL_SIZE));
  const rows = Math.max(1, Math.ceil(height / CELL_SIZE));
  const slot = new Int16Array(columns * rows).fill(-1);
  const nodeX = new Float32Array(columns * rows);
  const nodeY = new Float32Array(columns * rows);
  const radius = new Float32Array(columns * rows);
  const hot = new Uint8Array(columns * rows);
  let count = 0;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const key = (row * columns + column) * 6 + seed * 1000;
      if (unit(key) < EMPTY_CELL_SHARE) continue;
      slot[row * columns + column] = count;
      nodeX[count] = clamp((column + 0.15 + unit(key + 1) * 0.7) * CELL_SIZE, 0, width);
      nodeY[count] = clamp((row + 0.15 + unit(key + 2) * 0.7) * CELL_SIZE, 0, height);
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
        for (let step = pass ? FIRST_DIAGONAL : 0; step < (pass ? NEIGHBOR_STEPS.length : FIRST_DIAGONAL); step++) {
          const neighborColumn = column + NEIGHBOR_STEPS[step][0];
          const neighborRow = row + NEIGHBOR_STEPS[step][1];
          if (neighborColumn < 0 || neighborColumn >= columns || neighborRow >= rows) continue;
          const to = slot[neighborRow * columns + neighborColumn];
          if (to < 0 || unit((row * columns + column) * 6 + 5 + step * 17 + seed * 1000) > LINK_CHANCES[step]) continue;
          links[linkCount * 2] = from;
          links[linkCount * 2 + 1] = to;
          linkCount++;
        }
      }
    }
  }
  return { nodeX: nodeX.subarray(0, count), nodeY: nodeY.subarray(0, count), radius: radius.subarray(0, count), hot: hot.subarray(0, count), links, count, linkCount, diagonalFrom };
}

/** Draw the mesh. `progress` 0..1 is the entrance: synapses draw in one after another, then the nodes settle. */
export function drawMesh(drawingContext: CanvasRenderingContext2D, palette: Palette, mesh: Mesh, progress: number): void {
  const fade = smooth(progress / 0.35);
  if (fade <= 0) return;
  drawingContext.lineCap = "round";
  drawingContext.lineWidth = 0.6;
  drawingContext.strokeStyle = palette.metadata;
  for (let pass = 0; pass < 2; pass++) {
    drawingContext.globalAlpha = (pass ? DIAGONAL_ALPHA : EDGE_ALPHA) * fade;
    drawingContext.beginPath();
    for (let linkIndex = pass ? mesh.diagonalFrom : 0; linkIndex < (pass ? mesh.linkCount : mesh.diagonalFrom); linkIndex++) {
      const fromNode = mesh.links[linkIndex * 2];
      const toNode = mesh.links[linkIndex * 2 + 1];
      const growth = easeOutCubic(clamp((progress - 0.04 - (linkIndex / mesh.linkCount) * 0.4) / 0.3));
      if (growth <= 0) continue;
      drawingContext.moveTo(mesh.nodeX[fromNode], mesh.nodeY[fromNode]);
      drawingContext.lineTo(mesh.nodeX[fromNode] + (mesh.nodeX[toNode] - mesh.nodeX[fromNode]) * growth, mesh.nodeY[fromNode] + (mesh.nodeY[toNode] - mesh.nodeY[fromNode]) * growth);
    }
    drawingContext.stroke();
  }
  for (let pass = 0; pass < 2; pass++) {
    drawingContext.fillStyle = pass ? palette.sky : palette.metadata;
    drawingContext.globalAlpha = (pass ? HOT_ALPHA : NODE_ALPHA) * fade;
    drawingContext.beginPath();
    for (let nodeIndex = 0; nodeIndex < mesh.count; nodeIndex++) {
      if (mesh.hot[nodeIndex] !== pass) continue;
      const nodeRadius = mesh.radius[nodeIndex] * (pass ? 1.3 : 1);
      drawingContext.moveTo(mesh.nodeX[nodeIndex] + nodeRadius, mesh.nodeY[nodeIndex]);
      drawingContext.arc(mesh.nodeX[nodeIndex], mesh.nodeY[nodeIndex], nodeRadius, 0, FULL_TURN_RADIANS);
    }
    drawingContext.fill();
  }
  drawingContext.globalAlpha = 1;
}
