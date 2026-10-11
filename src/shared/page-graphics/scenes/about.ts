import { VEGA_NAME } from "../../lyra/constellation.ts";
import { stagger } from "../../canvas/clock.ts";
import { smooth } from "../../canvas/easing.ts";
import { FULL_TURN_RADIANS, type Point } from "../../canvas/geometry.ts";
import { drawCurve, drawNode, drawVegaBloom, entranceBloom } from "../../canvas/marks.ts";
import type { Palette } from "../../canvas/palette.ts";
import { labelBounds, reportFigureLeft } from "../container.ts";
import { drawLabel, placeLabel, type PlacedLabel } from "../labels.ts";
import { drawMesh, makeMesh, type Mesh } from "../mesh.ts";
import { mountCanvas, type CanvasHandle, type FrameState } from "../mount.ts";
import { createScrollReader } from "../scroll.ts";
import {
  BRANCH_STRIDE,
  buildTrajectory,
  pointOnPath,
  SAMPLES,
  trajectoryMarks,
  trajectorySegments,
  type Trajectory,
} from "./about-layout.ts";

// Trajectory: one curved path of neurons runs from the lower left to Vega. Faint
// branches show the paths not taken. The marker maps the reader's place on the page to
// the whole path: the start at the top of the page, Vega at the bottom. The path is lit up to
// the marker. The entrance draws the path in and lights it up to the marker and no further.
// A page that cannot scroll shows the whole path, lit to Vega.

/** The three orbit rings round Vega, as shares of the outer ring radius. */
const RING_SHARES = [0.36, 0.68, 1] as const;

/** Orbit rings round Vega, in the grid's line colour. */
function drawRings(drawingContext: CanvasRenderingContext2D, palette: Palette, trajectory: Trajectory, progress: number): void {
  drawingContext.strokeStyle = palette.grid;
  drawingContext.lineWidth = 1;
  for (let ringIndex = 0; ringIndex < 3; ringIndex++) {
    drawingContext.globalAlpha = smooth((progress - 0.1 - ringIndex * 0.08) / 0.3) * 2.4;
    drawingContext.beginPath();
    drawingContext.arc(trajectory.vegaX, trajectory.vegaY, trajectory.ringRadius * RING_SHARES[ringIndex], 0, FULL_TURN_RADIANS);
    drawingContext.stroke();
  }
  drawingContext.globalAlpha = 1;
}

/** Branches: drawn in faintly, then they fade to a ghost. Each ends in a hollow neuron. */
function drawBranches(drawingContext: CanvasRenderingContext2D, palette: Palette, trajectory: Trajectory, progress: number): void {
  const { branchCoordinates, branchNodeIndices } = trajectory;
  const ghost = 1 - 0.7 * smooth((progress - 0.5) / 0.4);
  for (let branchIndex = 0; branchIndex < trajectory.branchCount; branchIndex++) {
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
}

/** The path: dim in full, and sky up to the reach. */
function drawPath(drawingContext: CanvasRenderingContext2D, palette: Palette, trajectory: Trajectory, progress: number, reach: number): void {
  const { curve, pathX, pathY } = trajectory;
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
  if (litTo <= 1) return;
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

/**
 * Neurons on the path, with Vega last. Brightness and halo change with the reach in small steps,
 * so a node never pops as the light moves.
 */
function drawNeurons(
  drawingContext: CanvasRenderingContext2D,
  palette: Palette,
  glow: HTMLCanvasElement,
  trajectory: Trajectory,
  progress: number,
  reach: number,
): void {
  const { nodeX, nodeY, nodeFractions } = trajectory;
  for (let nodeIndex = 0; nodeIndex < trajectory.nodeCount - 1; nodeIndex++) {
    const lit = smooth((reach - nodeFractions[nodeIndex]) / 0.05 + 0.5);
    const halo = lit * smooth((1 - Math.abs(reach - nodeFractions[nodeIndex]) * 9) * 3);
    drawNode(
      drawingContext,
      palette,
      glow,
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
    glow,
    trajectory.vegaX,
    trajectory.vegaY,
    2.7,
    stagger(progress, 0.25, 0.25),
    true,
    1,
    true,
  );
}

export function mountAbout(container: HTMLElement): CanvasHandle | null {
  const scroll = createScrollReader(container);

  let trajectory: Trajectory | undefined;
  let mesh: Mesh | undefined;
  let vegaLabel: PlacedLabel | undefined;
  let lastProgress = -1;
  const marker: Point = { x: 0, y: 0 };

  // Rebuild the layout from the measured box. Nothing here depends on a CSS breakpoint.
  function build(state: FrameState) {
    scroll.measure();
    const { width, height } = state;
    trajectory = buildTrajectory(width, height);
    reportFigureLeft(container);
    // The neural mesh behind the path, and the Vega name on the side that no path or branch crosses.
    mesh = makeMesh(width, height, 5);
    vegaLabel = placeLabel(
      VEGA_NAME,
      trajectory.vegaX,
      trajectory.vegaY,
      {
        widthInPixels: state.labelFont.widthInPixels(VEGA_NAME),
        lineHeightInPixels: state.labelFont.lineHeightInPixels,
        bounds: labelBounds(container, width, height),
        segments: trajectorySegments(trajectory),
        avoid: trajectoryMarks(trajectory),
        gap: 16,
      },
    );
  }

  /**
   * The reach marker: a glow and a ring at the head of the light. It shows in the settled state too,
   * because it is where the reader is. It fades out as it reaches Vega, which is the arrival mark itself.
   */
  function drawReachMarker(drawingContext: CanvasRenderingContext2D, state: FrameState, path: Trajectory, reach: number): void {
    const strength = smooth(state.progress / 0.25) * (1 - smooth((reach - 0.94) / 0.06));
    if (strength <= 0) return;
    pointOnPath(path, reach, marker);
    drawingContext.globalAlpha = 0.9 * strength;
    drawingContext.drawImage(state.glow, marker.x - 14, marker.y - 14, 28, 28);
    drawingContext.strokeStyle = state.palette.sky;
    drawingContext.lineWidth = 0.8;
    drawingContext.globalAlpha = 0.7 * strength;
    drawingContext.beginPath();
    drawingContext.arc(marker.x, marker.y, 4.5, 0, FULL_TURN_RADIANS);
    drawingContext.stroke();
    drawingContext.globalAlpha = 1;
  }

  /** Publish the marker place for the tests when the value changes, at most once per frame. */
  function reportProgress(reach: number): void {
    const shown = Math.round(reach * 1000);
    if (shown === lastProgress) return;
    lastProgress = shown;
    container.dataset.progress = String(shown / 1000);
  }

  function draw(drawingContext: CanvasRenderingContext2D, state: FrameState) {
    if (!trajectory) return;
    const { progress, palette, glow } = state;
    // The marker is the reader's place on the whole path. A band, which does not follow the scroll, rests on Vega.
    const scrollShare = scroll.linked ? scroll.value(state) : 1;
    // The entrance front draws the light in from the start. The light never goes past the marker.
    const travel = stagger(progress, 0.3, 0.5);
    const front = travel >= 1 ? 1 : 1 - (1 - travel) ** 1.6;
    const reach = Math.min(scrollShare, front);

    if (mesh) drawMesh(drawingContext, palette, mesh, progress);
    drawRings(drawingContext, palette, trajectory, progress);
    drawBranches(drawingContext, palette, trajectory, progress);
    drawPath(drawingContext, palette, trajectory, progress, reach);
    drawNeurons(drawingContext, palette, glow, trajectory, progress, reach);
    drawReachMarker(drawingContext, state, trajectory, reach);
    // The arrival bloom on Vega, only when the light reaches it during the entrance.
    if (!state.reduced) {
      drawVegaBloom(drawingContext, glow, trajectory.vegaX, trajectory.vegaY, entranceBloom(progress) * smooth((reach - 0.9) / 0.1));
    }
    if (vegaLabel) drawLabel(drawingContext, palette, state.labelFont.canvasFont, vegaLabel, smooth((progress - 0.7) / 0.2));
    if (scroll.linked) reportProgress(reach);
    // Ask for more frames only while the marker still moves toward the scroll.
    return !state.reduced && scroll.linked && !scroll.settled;
  }

  return mountCanvas(container, { draw, onResize: build, attach: scroll.attach });
}
