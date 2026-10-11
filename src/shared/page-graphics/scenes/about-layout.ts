import { clamp, interpolate } from "../../motion/easing.ts";
import { cubicPoint, type Point } from "../../motion/geometry.ts";
import { unit } from "../../motion/random.ts";
import { FIGURE_INSET } from "../inset.ts";
import { around, polylineSegments, type Rectangle, type Segment } from "../labels.ts";

// The layout of the About graphic, "Trajectory". It has no DOM and no canvas, so a test can run it.
// Build it on resize, not per frame.

/** The path is sampled at this many steps. */
export const SAMPLES = 160;
/** The space between the outer Vega ring and the box edge, in CSS pixels. */
const RING_MARGIN = 24;
/** The outer Vega ring has at most this radius. */
const MAXIMUM_RING_RADIUS = 180;
/** Numbers per branch: a start, two controls, and an end, as x and y. */
export const BRANCH_STRIDE = 8;

interface AboutLayout {
  /** True for a band, where the path runs sideways. */
  horizontal: boolean;
  /** The place of Vega, and the radius of its outer ring. The ring fits inside the box with RING_MARGIN to spare. */
  vx: number;
  vy: number;
  ring: number;
  /** The path as x and y of a start, two controls, and an end. Every point lies inside the figure inset. */
  curve: number[];
}

/**
 * The path and Vega use the supplied width and height. The whole figure fits inside the box: Vega keeps
 * its outer ring radius plus RING_MARGIN from the right edge and the top, and the path stays inside the
 * figure inset. The control points lie inside the inset too, so the curve cannot leave it.
 */
export function aboutLayout(width: number, height: number): AboutLayout {
  const horizontal = width > height * 1.3;
  const ring = clamp(Math.min(width * 0.4, height * 0.28), 20, MAXIMUM_RING_RADIUS);
  const vx = width - ring - RING_MARGIN;
  const vy = ring + RING_MARGIN;
  const left = Math.max(FIGURE_INSET, width * 0.1);
  const bottom = height - FIGURE_INSET;
  const curve = horizontal
    ? [FIGURE_INSET, bottom, width * 0.4, bottom, width * 0.55, vy, vx, vy]
    : [left, bottom - 8, width - FIGURE_INSET, height * 0.78, FIGURE_INSET, height * 0.36, vx, vy];
  return { horizontal, vx, vy, ring, curve };
}

export interface Trajectory extends AboutLayout {
  /** The path, sampled at SAMPLES + 1 points from the start to Vega. */
  pathX: Float32Array;
  pathY: Float32Array;
  /** The neurons on the path, at even arc length. The last one sits on Vega. */
  nodeX: Float32Array;
  nodeY: Float32Array;
  /** The share of the path where each neuron sits. */
  nodeFractions: Float32Array;
  nodeCount: number;
  /** BRANCH_STRIDE numbers for each branch. */
  branchCoordinates: Float32Array;
  /** The neuron that each branch leaves from. */
  branchNodeIndices: Float32Array;
  branchCount: number;
}

/** Sample the path, place the neurons at even arc length, and grow the branches: the paths not taken. */
export function buildTrajectory(width: number, height: number): Trajectory {
  const layout = aboutLayout(width, height);
  const { horizontal, curve } = layout;
  const start: Point = { x: curve[0], y: curve[1] };
  const control1: Point = { x: curve[2], y: curve[3] };
  const control2: Point = { x: curve[4], y: curve[5] };
  const end: Point = { x: layout.vx, y: layout.vy };
  const scratch: Point = { x: 0, y: 0 };
  const pathX = new Float32Array(SAMPLES + 1);
  const pathY = new Float32Array(SAMPLES + 1);
  const cumulative = new Float32Array(SAMPLES + 1);
  let length = 0;
  for (let sampleIndex = 0; sampleIndex <= SAMPLES; sampleIndex++) {
    cubicPoint(scratch, sampleIndex / SAMPLES, start, control1, control2, end);
    pathX[sampleIndex] = scratch.x;
    pathY[sampleIndex] = scratch.y;
  }
  for (let sampleIndex = 1; sampleIndex <= SAMPLES; sampleIndex++) {
    length += Math.hypot(pathX[sampleIndex] - pathX[sampleIndex - 1], pathY[sampleIndex] - pathY[sampleIndex - 1]);
    cumulative[sampleIndex] = length;
  }

  // Nodes at even arc length.
  const segmentCount = clamp(Math.round(length / (horizontal ? 46 : 52)), 8, 18);
  const nodeCount = segmentCount + 1;
  const nodeX = new Float32Array(nodeCount);
  const nodeY = new Float32Array(nodeCount);
  const nodeFractions = new Float32Array(nodeCount);
  const at = new Int16Array(nodeCount);
  let nearestSampleIndex = 0;
  for (let nodeIndex = 0; nodeIndex <= segmentCount; nodeIndex++) {
    const distance = (nodeIndex / segmentCount) * length;
    while (nearestSampleIndex < SAMPLES && cumulative[nearestSampleIndex] < distance) nearestSampleIndex++;
    at[nodeIndex] = nearestSampleIndex;
    nodeFractions[nodeIndex] = nearestSampleIndex / SAMPLES;
    nodeX[nodeIndex] = pathX[nearestSampleIndex];
    nodeY[nodeIndex] = pathY[nearestSampleIndex];
  }

  // Branches: the paths not taken. They alternate sides and each ends in a hollow neuron.
  const branchCapacity = segmentCount * 2;
  const branchCoordinates = new Float32Array(branchCapacity * BRANCH_STRIDE);
  const branchNodeIndices = new Float32Array(branchCapacity);
  let branchCount = 0;
  const padding = FIGURE_INSET;
  for (let nodeIndex = 1; nodeIndex < segmentCount - 1; nodeIndex++) {
    for (let branchPass = 0; branchPass < 2; branchPass++) {
      if (branchPass === 1 && unit(nodeIndex * 9 + 2) < 0.55) continue;
      const sampleIndex = at[nodeIndex];
      const sampleBefore = Math.max(0, sampleIndex - 3);
      const sampleAfter = Math.min(SAMPLES, sampleIndex + 3);
      const tx = pathX[sampleAfter] - pathX[sampleBefore];
      const ty = pathY[sampleAfter] - pathY[sampleBefore];
      const tangentLength = Math.hypot(tx, ty) || 1;
      const side = (nodeIndex + branchPass) % 2 ? 1 : -1;
      const angle = side * (0.6 + unit(nodeIndex * 5 + branchPass) * 0.6) * (branchPass ? -1 : 1);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const dx = (tx * cos - ty * sin) / tangentLength;
      const dy = (tx * sin + ty * cos) / tangentLength;
      const reach = (horizontal ? 34 : 52) + unit(nodeIndex * 3 + branchPass * 7) * (horizontal ? 30 : 60) * (branchPass ? 0.7 : 1);
      const ex = clamp(nodeX[nodeIndex] + dx * reach, padding, width - padding);
      const ey = clamp(nodeY[nodeIndex] + dy * reach, padding, height - padding);
      const branchOffset = branchCount * BRANCH_STRIDE;
      branchCoordinates[branchOffset] = nodeX[nodeIndex];
      branchCoordinates[branchOffset + 1] = nodeY[nodeIndex];
      branchCoordinates[branchOffset + 2] = clamp(nodeX[nodeIndex] + (tx / tangentLength) * reach * 0.45, padding, width - padding);
      branchCoordinates[branchOffset + 3] = clamp(nodeY[nodeIndex] + (ty / tangentLength) * reach * 0.45, padding, height - padding);
      branchCoordinates[branchOffset + 4] = clamp(ex - dx * reach * 0.3, padding, width - padding);
      branchCoordinates[branchOffset + 5] = clamp(ey - dy * reach * 0.3, padding, height - padding);
      branchCoordinates[branchOffset + 6] = ex;
      branchCoordinates[branchOffset + 7] = ey;
      branchNodeIndices[branchCount] = nodeIndex;
      branchCount++;
    }
  }
  return { ...layout, pathX, pathY, nodeX, nodeY, nodeFractions, nodeCount, branchCoordinates, branchNodeIndices, branchCount };
}

/** The lines that the Vega name must not cross: the path, and the straight span of each branch. */
export function trajectorySegments(trajectory: Trajectory): Segment[] {
  const { branchCoordinates } = trajectory;
  const segments: Segment[] = [];
  polylineSegments(trajectory.pathX, trajectory.pathY, segments);
  for (let branchIndex = 0; branchIndex < trajectory.branchCount; branchIndex++) {
    const branchOffset = branchIndex * BRANCH_STRIDE;
    segments.push({ ax: branchCoordinates[branchOffset], ay: branchCoordinates[branchOffset + 1], bx: branchCoordinates[branchOffset + 6], by: branchCoordinates[branchOffset + 7] });
  }
  return segments;
}

/** The marks that the Vega name must keep clear of: Vega, and each neuron on the path before it. */
export function trajectoryMarks(trajectory: Trajectory): Rectangle[] {
  const avoid: Rectangle[] = [around(trajectory.vx, trajectory.vy, 10)];
  for (let nodeIndex = 0; nodeIndex < trajectory.nodeCount - 1; nodeIndex++) avoid.push(around(trajectory.nodeX[nodeIndex], trajectory.nodeY[nodeIndex], 6));
  return avoid;
}

/** The point at a share of the path, between two samples. Fills `outputPoint` and returns it. */
export function pointOnPath(trajectory: Trajectory, share: number, outputPoint: Point): Point {
  const samplePosition = clamp(share) * SAMPLES;
  const sampleIndex = Math.min(SAMPLES - 1, Math.floor(samplePosition));
  const sampleShare = samplePosition - sampleIndex;
  outputPoint.x = interpolate(trajectory.pathX[sampleIndex], trajectory.pathX[sampleIndex + 1], sampleShare);
  outputPoint.y = interpolate(trajectory.pathY[sampleIndex], trajectory.pathY[sampleIndex + 1], sampleShare);
  return outputPoint;
}
