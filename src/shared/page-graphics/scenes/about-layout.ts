import { clamp, interpolate } from "../../canvas/easing.ts";
import { cubicPoint, type Point } from "../../canvas/geometry.ts";
import { unit } from "../../canvas/random.ts";
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
  vegaX: number;
  vegaY: number;
  ringRadius: number;
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
  const ringRadius = clamp(Math.min(width * 0.4, height * 0.28), 20, MAXIMUM_RING_RADIUS);
  const vegaX = width - ringRadius - RING_MARGIN;
  const vegaY = ringRadius + RING_MARGIN;
  const left = Math.max(FIGURE_INSET, width * 0.1);
  const bottom = height - FIGURE_INSET;
  const curve = horizontal
    ? [FIGURE_INSET, bottom, width * 0.4, bottom, width * 0.55, vegaY, vegaX, vegaY]
    : [left, bottom - 8, width - FIGURE_INSET, height * 0.78, FIGURE_INSET, height * 0.36, vegaX, vegaY];
  return { horizontal, vegaX, vegaY, ringRadius, curve };
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
  const end: Point = { x: layout.vegaX, y: layout.vegaY };
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
  const nodeSampleIndices = new Int16Array(nodeCount);
  let nearestSampleIndex = 0;
  for (let nodeIndex = 0; nodeIndex <= segmentCount; nodeIndex++) {
    const distance = (nodeIndex / segmentCount) * length;
    while (nearestSampleIndex < SAMPLES && cumulative[nearestSampleIndex] < distance) nearestSampleIndex++;
    nodeSampleIndices[nodeIndex] = nearestSampleIndex;
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
      const sampleIndex = nodeSampleIndices[nodeIndex];
      const sampleBefore = Math.max(0, sampleIndex - 3);
      const sampleAfter = Math.min(SAMPLES, sampleIndex + 3);
      const tangentX = pathX[sampleAfter] - pathX[sampleBefore];
      const tangentY = pathY[sampleAfter] - pathY[sampleBefore];
      const tangentLength = Math.hypot(tangentX, tangentY) || 1;
      const side = (nodeIndex + branchPass) % 2 ? 1 : -1;
      const angle = side * (0.6 + unit(nodeIndex * 5 + branchPass) * 0.6) * (branchPass ? -1 : 1);
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const directionX = (tangentX * cosine - tangentY * sine) / tangentLength;
      const directionY = (tangentX * sine + tangentY * cosine) / tangentLength;
      const reach = (horizontal ? 34 : 52) + unit(nodeIndex * 3 + branchPass * 7) * (horizontal ? 30 : 60) * (branchPass ? 0.7 : 1);
      const branchEndX = clamp(nodeX[nodeIndex] + directionX * reach, padding, width - padding);
      const branchEndY = clamp(nodeY[nodeIndex] + directionY * reach, padding, height - padding);
      const branchOffset = branchCount * BRANCH_STRIDE;
      branchCoordinates[branchOffset] = nodeX[nodeIndex];
      branchCoordinates[branchOffset + 1] = nodeY[nodeIndex];
      branchCoordinates[branchOffset + 2] = clamp(nodeX[nodeIndex] + (tangentX / tangentLength) * reach * 0.45, padding, width - padding);
      branchCoordinates[branchOffset + 3] = clamp(nodeY[nodeIndex] + (tangentY / tangentLength) * reach * 0.45, padding, height - padding);
      branchCoordinates[branchOffset + 4] = clamp(branchEndX - directionX * reach * 0.3, padding, width - padding);
      branchCoordinates[branchOffset + 5] = clamp(branchEndY - directionY * reach * 0.3, padding, height - padding);
      branchCoordinates[branchOffset + 6] = branchEndX;
      branchCoordinates[branchOffset + 7] = branchEndY;
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
    segments.push({ startX: branchCoordinates[branchOffset], startY: branchCoordinates[branchOffset + 1], endX: branchCoordinates[branchOffset + 6], endY: branchCoordinates[branchOffset + 7] });
  }
  return segments;
}

/** The marks that the Vega name must keep clear of: Vega, and each neuron on the path before it. */
export function trajectoryMarks(trajectory: Trajectory): Rectangle[] {
  const avoid: Rectangle[] = [around(trajectory.vegaX, trajectory.vegaY, 10)];
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
