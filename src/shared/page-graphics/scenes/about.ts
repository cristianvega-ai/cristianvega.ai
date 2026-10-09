import { cubicPoint, type Point } from "../../motion/easing.ts";
import { stagger } from "../../motion/clock.ts";
import {
  around,
  labelBounds,
  placeLabel,
  polylineSegments,
  type PlacedLabel,
  type Rectangle,
  type Segment,
} from "../labels.ts";
import { drawMesh, makeMesh, type Mesh } from "../mesh.ts";
import { drawCurve, drawLabel, drawNode, drawVegaBloom } from "../marks.ts";
import { FIGURE_INSET, reportFigureLeft } from "../inset.ts";
import { clamp, interpolate, smooth, FULL_TURN_RADIANS, unit } from "../math.ts";
import { mountCanvas, type CanvasHandle, type FrameState } from "../mount.ts";
import { createScrollReader } from "../scroll.ts";

// Trajectory: one curved path of neurons runs from the lower left to Vega. Faint
// branches show the paths not taken. The marker maps the reader's place on the page to
// the whole path: the start at the top of the page, Vega at the bottom. The path is lit up to
// the marker. The entrance draws the path in and lights it up to the marker and no further.
// A page that cannot scroll shows the whole path, lit to Vega.

const SAMPLES = 160;
/** The space between the outer Vega ring and the box edge, in CSS pixels. */
export const RING_MARGIN = 24;
/** The outer Vega ring has at most this radius. The three rings are these shares of it. */
const MAXIMUM_RING_RADIUS = 180;
const RING_SHARES = [0.36, 0.68, 1] as const;
/** Numbers per branch: a start, two controls, and an end, as x and y. */
const BRANCH_STRIDE = 8;

export interface AboutLayout {
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

export function mountAbout(container: HTMLElement): CanvasHandle | null {
  const scroll = createScrollReader(container);

  let horizontal = false;
  let nodeCount = 0;
  let branchCount = 0;
  // The path as x and y of a start, two controls, and an end.
  let curve = [0, 0, 0, 0, 0, 0, 0, 0];
  const pathX = new Float32Array(SAMPLES + 1);
  const pathY = new Float32Array(SAMPLES + 1);
  const cumulative = new Float32Array(SAMPLES + 1);
  let nodeX = new Float32Array(0);
  let nodeY = new Float32Array(0);
  let nodeFractions = new Float32Array(0);
  let branchCoordinates = new Float32Array(0);
  let branchNodeIndices = new Float32Array(0);
  let vx = 0;
  let vy = 0;
  let mesh: Mesh | undefined;
  let vegaLabel: PlacedLabel | undefined;
  let ringRadius = 0;
  let lastProgress = -1;
  const scratch: Point = { x: 0, y: 0 };
  const start: Point = { x: 0, y: 0 };
  const control1: Point = { x: 0, y: 0 };
  const control2: Point = { x: 0, y: 0 };
  const end: Point = { x: 0, y: 0 };

  // Rebuild the layout from the measured box. Nothing here depends on a CSS breakpoint.
  function build(state: FrameState) {
    scroll.measure();
    const layout = aboutLayout(state.width, state.height);
    reportFigureLeft(container, state.width, state.height);
    const { width, height } = state;
    horizontal = layout.horizontal;
    curve = layout.curve;
    ringRadius = layout.ring;
    vx = layout.vx;
    vy = layout.vy;
    start.x = curve[0];
    start.y = curve[1];
    control1.x = curve[2];
    control1.y = curve[3];
    control2.x = curve[4];
    control2.y = curve[5];
    end.x = vx;
    end.y = vy;
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
    nodeCount = segmentCount + 1;
    nodeX = new Float32Array(nodeCount);
    nodeY = new Float32Array(nodeCount);
    nodeFractions = new Float32Array(nodeCount);
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
    branchCoordinates = new Float32Array(branchCapacity * BRANCH_STRIDE);
    branchNodeIndices = new Float32Array(branchCapacity);
    branchCount = 0;
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

    // The neural mesh behind the path, and the Vega name on the side that no path or branch crosses.
    mesh = makeMesh(width, height, 5);
    const segments: Segment[] = [];
    polylineSegments(pathX, pathY, segments);
    for (let branchIndex = 0; branchIndex < branchCount; branchIndex++) {
      const branchOffset = branchIndex * BRANCH_STRIDE;
      segments.push({ ax: branchCoordinates[branchOffset], ay: branchCoordinates[branchOffset + 1], bx: branchCoordinates[branchOffset + 6], by: branchCoordinates[branchOffset + 7] });
    }
    const avoid: Rectangle[] = [around(vx, vy, 10)];
    for (let nodeIndex = 0; nodeIndex < nodeCount - 1; nodeIndex++) avoid.push(around(nodeX[nodeIndex], nodeY[nodeIndex], 6));
    vegaLabel = placeLabel(
      "VEGA · α LYR",
      vx,
      vy,
      {
        widthInPixels: state.labelFont.widthInPixels("VEGA · α LYR"),
        lineHeightInPixels: state.labelFont.lineHeightInPixels,
        bounds: labelBounds(container, width, height),
        segments,
        avoid,
        gap: 16,
      },
    );
  }

  function pointAt(share: number, outputPoint: Point): Point {
    const samplePosition = clamp(share) * SAMPLES;
    const sampleIndex = Math.min(SAMPLES - 1, Math.floor(samplePosition));
    const sampleShare = samplePosition - sampleIndex;
    outputPoint.x = interpolate(pathX[sampleIndex], pathX[sampleIndex + 1], sampleShare);
    outputPoint.y = interpolate(pathY[sampleIndex], pathY[sampleIndex + 1], sampleShare);
    return outputPoint;
  }

  function draw(drawingContext: CanvasRenderingContext2D, state: FrameState) {
    const progress = state.progress;
    const palette = state.palette;
    // The marker is the reader's place on the whole path. A band, which does not follow the scroll, rests on Vega.
    const marker = scroll.linked ? scroll.value(state) : 1;
    // The entrance front draws the light in from the start. The light never goes past the marker.
    const travel = stagger(progress, 0.3, 0.5);
    const front = travel >= 1 ? 1 : 1 - (1 - travel) ** 1.6;
    const reach = Math.min(marker, front);

    if (mesh) drawMesh(drawingContext, palette, mesh, progress);

    // Orbit rings round Vega, in the grid's line colour.
    drawingContext.strokeStyle = palette.grid;
    drawingContext.lineWidth = 1;
    for (let ringIndex = 0; ringIndex < 3; ringIndex++) {
      drawingContext.globalAlpha = smooth((progress - 0.1 - ringIndex * 0.08) / 0.3) * 2.4;
      drawingContext.beginPath();
      drawingContext.arc(vx, vy, ringRadius * RING_SHARES[ringIndex], 0, FULL_TURN_RADIANS);
      drawingContext.stroke();
    }
    drawingContext.globalAlpha = 1;

    // Branches: drawn in faintly, then they fade to a ghost.
    const ghost = 1 - 0.7 * smooth((progress - 0.5) / 0.4);
    for (let branchIndex = 0; branchIndex < branchCount; branchIndex++) {
      const branchOffset = branchIndex * BRANCH_STRIDE;
      const branchProgress = stagger(progress, 0.12 + branchNodeIndices[branchIndex] * 0.022, 0.26);
      if (branchProgress <= 0) continue;
      drawCurve(
        drawingContext,
        palette,
        branchCoordinates[branchOffset],
        branchCoordinates[branchOffset + 1],
        branchCoordinates[branchOffset + 2],
        branchCoordinates[branchOffset + 3],
        branchCoordinates[branchOffset + 4],
        branchCoordinates[branchOffset + 5],
        branchCoordinates[branchOffset + 6],
        branchCoordinates[branchOffset + 7],
        branchProgress,
        false,
        0.5 * ghost,
      );
      if (branchProgress >= 1) {
        drawingContext.globalAlpha = 0.5 * ghost;
        drawingContext.strokeStyle = palette.metadata;
        drawingContext.lineWidth = 0.7;
        drawingContext.beginPath();
        drawingContext.arc(
          branchCoordinates[branchOffset + 6],
          branchCoordinates[branchOffset + 7],
          2,
          0,
          FULL_TURN_RADIANS,
        );
        drawingContext.stroke();
        drawingContext.globalAlpha = 1;
      }
    }

    // The path: dim in full, and sky up to the reach.
    drawCurve(
      drawingContext,
      palette,
      curve[0],
      curve[1],
      curve[2],
      curve[3],
      curve[4],
      curve[5],
      curve[6],
      curve[7],
      stagger(progress, 0.04, 0.36),
      false,
      0.3,
    );
    const litTo = Math.floor(reach * SAMPLES);
    if (litTo > 1) {
      drawingContext.lineCap = "round";
      drawingContext.lineJoin = "round";
      drawingContext.strokeStyle = palette.sky;
      for (let pass = 0; pass < 2; pass++) {
        const from = pass ? Math.floor(litTo * 0.7) : 0;
        drawingContext.globalAlpha = pass ? 0.95 : 0.55;
        drawingContext.lineWidth = pass ? 1.5 : 1.1;
        drawingContext.beginPath();
        drawingContext.moveTo(pathX[from], pathY[from]);
        for (let sampleIndex = from + 1; sampleIndex <= litTo; sampleIndex++) drawingContext.lineTo(pathX[sampleIndex], pathY[sampleIndex]);
        drawingContext.stroke();
      }
      drawingContext.globalAlpha = 1;
    }

    // Neurons on the path, with Vega last.
    // Brightness and halo change with the reach in small steps, so a node never pops as the light moves.
    for (let nodeIndex = 0; nodeIndex < nodeCount - 1; nodeIndex++) {
      const lit = smooth((reach - nodeFractions[nodeIndex]) / 0.05 + 0.5);
      const halo = lit * smooth((1 - Math.abs(reach - nodeFractions[nodeIndex]) * 9) * 3);
      drawNode(
        drawingContext,
        palette,
        state.glow,
        nodeX[nodeIndex],
        nodeY[nodeIndex],
        1.5 + 1.1 * nodeFractions[nodeIndex],
        stagger(progress, 0.06 + nodeIndex * 0.02, 0.16),
        halo > 0.02,
        0.4 + 0.55 * lit,
        false,
        halo,
      );
    }
    drawNode(
      drawingContext,
      palette,
      state.glow,
      vx,
      vy,
      2.7,
      stagger(progress, 0.25, 0.25),
      true,
      1,
      true,
    );

    // The reach marker: a glow and a ring at the head of the light. It shows in the settled state too,
    // because it is where the reader is. It fades out as it reaches Vega, which is the arrival mark itself.
    const a = smooth(progress / 0.25) * (1 - smooth((reach - 0.94) / 0.06));
    if (a > 0) {
      pointAt(reach, scratch);
      drawingContext.globalAlpha = 0.9 * a;
      drawingContext.drawImage(state.glow, scratch.x - 14, scratch.y - 14, 28, 28);
      drawingContext.strokeStyle = palette.sky;
      drawingContext.lineWidth = 0.8;
      drawingContext.globalAlpha = 0.7 * a;
      drawingContext.beginPath();
      drawingContext.arc(scratch.x, scratch.y, 4.5, 0, FULL_TURN_RADIANS);
      drawingContext.stroke();
      drawingContext.globalAlpha = 1;
    }

    // The arrival bloom on Vega, only when the light reaches it during the entrance.
    if (!state.reduced) {
      drawVegaBloom(
        drawingContext,
        state.glow,
        vx,
        vy,
        smooth((progress - 0.62) / 0.22) * (1 - smooth((progress - 0.84) / 0.16)) * smooth((reach - 0.9) / 0.1),
      );
    }
    const labelIn = smooth((progress - 0.7) / 0.2);
    if (vegaLabel) {
      drawLabel(
        drawingContext,
        palette,
        state.labelFont.canvasFont,
        vegaLabel.text,
        vegaLabel.x,
        vegaLabel.y,
        vegaLabel.align,
        labelIn,
      );
    }

    // The marker place for the tests, written when the value changes, and at most once per frame.
    if (scroll.linked) {
      const shown = Math.round(reach * 1000);
      if (shown !== lastProgress) {
        lastProgress = shown;
        container.dataset.progress = String(shown / 1000);
      }
    }
    // Ask for more frames only while the marker still moves toward the scroll.
    return !state.reduced && scroll.linked && !scroll.settled;
  }

  return mountCanvas(container, { draw, onResize: build, attach: scroll.attach });
}
