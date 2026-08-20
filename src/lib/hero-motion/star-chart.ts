import { clamp, easeOutCubic, FULL_TURN_RADIANS, progress, smoothstep } from "./easing";
import type { CanvasLayer } from "./layout";
import {
  PORTRAIT_DOT_DURATION,
  TRANSFER_TRAVEL_DURATION,
  WINDOWS,
} from "./timeline";

// Chart palette for the dark masthead
export const STAR = "#E4E9F2";
export const SIGNAL = "#D42A3C";
export const EMBER = "#F2792B";
export const CHART_META = "#7C8595";

export const TRANSFER_EDGE_FRACTION = 0.32;
export const SATELLITE_PERIOD = 9000;
export const SATELLITE_DURATION = 1500;
export const SATELLITE_FIRST_PASS = 2600;
export const SATELLITE_TRAIL_LENGTH = 16;
// Ambient repaint budget (~15fps): the slow twinkle and Vega's breath read
// identically at this cadence; satellite passes still draw every frame.
export const AMBIENT_FRAME_INTERVAL_MS = 66;

// The six principal stars of Lyra as flat-chart offsets from Vega in degrees
// (screen x right, y down; RA deltas scaled by cos dec), from J2000 positions.
type LyraStar = { x: number; y: number; mag: number; name?: string };
const LYRA: LyraStar[] = [
  { x: 0.0, y: 0.0, mag: 0.03, name: "VEGA · α LYR" },
  { x: -1.44, y: -0.89, mag: 3.9 }, // epsilon — the Double Double
  { x: -1.54, y: 1.18, mag: 4.36 }, // zeta
  { x: -3.43, y: 1.81, mag: 4.22 }, // delta
  { x: -2.57, y: 5.42, mag: 3.52, name: "SHELIAK" }, // beta
  { x: -4.3, y: 6.09, mag: 3.25, name: "SULAFAT" }, // gamma
];
// The classic figure: Vega→epsilon, Vega→zeta, then around the parallelogram.
const LYRA_LINKS = [
  [0, 1],
  [0, 2],
  [2, 3],
  [3, 5],
  [5, 4],
  [4, 2],
] as const;
const CHART_ROT = 0.15; // slight tilt so the parallelogram hangs below-left
const FIELD_STARS = 44;
// Fixed low-discrepancy offsets so the field layout is identical on every draw
const FIELD_SEED_X = 0.1372;
const FIELD_SEED_Y = 0.6289;

type ChartLabel = {
  chars: string[];
  advances: Float32Array;
  x: number;
  y: number;
  alpha: number;
  font: string;
};

type ChartLane = {
  startX: number;
  startY: number;
  controlX: number;
  controlY: number;
  endX: number;
  endY: number;
};

type ChartScene = {
  links: Float32Array; // trimmed segments: x1,y1,x2,y2 per link
  graticule: Float32Array; // cx,cy,r per arc
  ticks: Path2D;
  labels: ChartLabel[];
  vega: HTMLCanvasElement;
  vegaHalf: number;
  twinkleAmp: Float32Array;
  twinkleSpeed: Float32Array;
  twinklePhase: Float32Array;
  baseAlpha: Float32Array;
  lanes: ChartLane[];
  trailColors: string[];
};

export type PortraitPrep = {
  starCount: number;
  chartX: Float32Array;
  chartY: Float32Array;
  starDelay: Float32Array;
  screenX: Float32Array;
  screenY: Float32Array;
  starRadius: Float32Array;
  isSource: Uint8Array;
  sourceIndices: number[];
  chart: ChartScene;
};

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function mixRgb(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function rgbString(c: [number, number, number], alpha?: number): string {
  return alpha === undefined
    ? `rgb(${c[0]},${c[1]},${c[2]})`
    : `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}

const LABEL_FONT = '500 10px "IBM Plex Mono", ui-monospace, monospace';
const LABEL_FONT_SMALL = '500 9px "IBM Plex Mono", ui-monospace, monospace';

function makeLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  font: string,
  letterSpacing: number,
): { chars: string[]; advances: Float32Array; width: number } {
  ctx.font = font;
  const chars = text.split("");
  const advances = new Float32Array(chars.length);
  let x = 0;
  for (let i = 0; i < chars.length; i++) {
    advances[i] = x;
    x += ctx.measureText(chars[i]).width + letterSpacing;
  }
  return { chars, advances, width: x - letterSpacing };
}

/**
 * Lay out the Lyra chart for a canvas layer: principal stars first, then a
 * deterministic low-discrepancy background field, links, graticule, ticks,
 * labels, satellite lanes, and the prerendered Vega sprite.
 * Star arrays double as the fly-in particle set for the entrance.
 */
function prepareScene(layer: CanvasLayer): PortraitPrep {
  const { ctx, rect, dpr } = layer;
  const canvasWidth = rect.width;
  const canvasHeight = rect.height;
  const smallerCanvasSide = Math.min(canvasWidth, canvasHeight);
  const scale = smallerCanvasSide * 0.075; // px per chart degree
  const starScale = Math.max(0.62, Math.min(1.1, scale / 46));

  const principalStarCount = LYRA.length;
  const starCount = principalStarCount + FIELD_STARS;
  const chartX = new Float32Array(starCount);
  const chartY = new Float32Array(starCount);
  const starDelay = new Float32Array(starCount);
  const screenX = new Float32Array(starCount);
  const screenY = new Float32Array(starCount);
  const starRadius = new Float32Array(starCount);
  const isSource = new Uint8Array(starCount);

  // Principal stars: rotate the chart, center the figure slightly up-left
  const chartCosine = Math.cos(CHART_ROT);
  const chartSine = Math.sin(CHART_ROT);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < principalStarCount; i++) {
    const rotatedX = LYRA[i].x * chartCosine - LYRA[i].y * chartSine;
    const rotatedY = LYRA[i].x * chartSine + LYRA[i].y * chartCosine;
    screenX[i] = rotatedX;
    screenY[i] = rotatedY;
    minX = Math.min(minX, rotatedX);
    maxX = Math.max(maxX, rotatedX);
    minY = Math.min(minY, rotatedY);
    maxY = Math.max(maxY, rotatedY);
  }
  const figureCenterX = (minX + maxX) / 2;
  const figureCenterY = (minY + maxY) / 2;
  for (let i = 0; i < principalStarCount; i++) {
    screenX[i] = canvasWidth * 0.45 + (screenX[i] - figureCenterX) * scale;
    screenY[i] = canvasHeight * 0.44 + (screenY[i] - figureCenterY) * scale;
    starRadius[i] = (1.05 + 3.95 * Math.exp(-0.42 * LYRA[i].mag)) * starScale;
  }

  // Entrance order: brightest first
  const order = LYRA.map((_, i) => i).sort((a, b) => LYRA[a].mag - LYRA[b].mag);
  for (let i = 0; i < principalStarCount; i++) starDelay[order[i]] = i * 55;

  // Background field: fixed R2 sequence so the sky is identical on every draw
  for (let k = 0; k < FIELD_STARS; k++) {
    const i = principalStarCount + k;
    let fieldX = ((FIELD_SEED_X + k * 0.7548776662) % 1) * canvasWidth * 0.96 + canvasWidth * 0.02;
    let fieldY = ((FIELD_SEED_Y + k * 0.569840291) % 1) * canvasHeight * 0.94 + canvasHeight * 0.03;
    for (let j = 0; j < principalStarCount; j++) {
      const distanceX = fieldX - screenX[j];
      const distanceY = fieldY - screenY[j];
      const distance = Math.hypot(distanceX, distanceY);
      if (distance < 26) {
        if (distance < 0.001) fieldX += 26;
        else {
          const push = (26 - distance) / distance;
          fieldX += distanceX * push;
          fieldY += distanceY * push;
        }
      }
    }
    screenX[i] = fieldX;
    screenY[i] = fieldY;
    starRadius[i] = 0.45 + (((k * 7) % 9) / 9) * 0.75;
    starDelay[i] = 90 + ((k * 13) % 10) * 14 + Math.random() * 80;
  }

  // Fly-in scatter: gentle radial drift toward each star's resting place.
  // Vega (index 0) fades in at rest, so it is deliberately left unscattered.
  const chartCenterX = canvasWidth * 0.45;
  const chartCenterY = canvasHeight * 0.44;
  for (let i = 1; i < starCount; i++) {
    const distanceX = screenX[i] - chartCenterX;
    const distanceY = screenY[i] - chartCenterY;
    const distance = Math.hypot(distanceX, distanceY) || 1;
    const drift = 14 + Math.random() * 40;
    chartX[i] = (distanceX / distance) * drift + (Math.random() - 0.5) * 18;
    chartY[i] = (distanceY / distance) * drift + (Math.random() - 0.5) * 18;
  }

  // Transfer sources: background stars in the chart's right band send
  // starlight across the seam to form the hero copy.
  let starMinX = Infinity;
  let starMaxX = -Infinity;
  for (let i = 0; i < starCount; i++) {
    starMinX = Math.min(starMinX, screenX[i]);
    starMaxX = Math.max(starMaxX, screenX[i]);
  }
  const edgeStartX = starMaxX - (starMaxX - starMinX) * TRANSFER_EDGE_FRACTION;
  const edgeCandidates: number[] = [];
  for (let i = principalStarCount; i < starCount; i++) {
    if (screenX[i] >= edgeStartX) edgeCandidates.push(i);
  }
  edgeCandidates.sort((a, b) => screenY[a] - screenY[b]);
  const sourceIndices: number[] = [];
  for (const idx of edgeCandidates) {
    isSource[idx] = 1;
    sourceIndices.push(idx);
  }

  // Links trimmed so strokes stop short of the stars
  const links = new Float32Array(LYRA_LINKS.length * 4);
  for (let i = 0; i < LYRA_LINKS.length; i++) {
    const a = LYRA_LINKS[i][0];
    const b = LYRA_LINKS[i][1];
    const deltaX = screenX[b] - screenX[a];
    const deltaY = screenY[b] - screenY[a];
    const linkDistance = Math.hypot(deltaX, deltaY) || 1;
    const gapA = starRadius[a] * 2 + 6;
    const gapB = starRadius[b] * 2 + 6;
    links[i * 4] = screenX[a] + (deltaX / linkDistance) * gapA;
    links[i * 4 + 1] = screenY[a] + (deltaY / linkDistance) * gapA;
    links[i * 4 + 2] = screenX[b] - (deltaX / linkDistance) * gapB;
    links[i * 4 + 3] = screenY[b] - (deltaY / linkDistance) * gapB;
  }

  // Graticule: three huge-radius arcs whispering through the sky
  const graticule1X = canvasWidth * 1.62;
  const graticule1Y = -canvasHeight * 0.72;
  const graticule1Radius = Math.hypot(graticule1X - canvasWidth * 0.3, graticule1Y - canvasHeight * 0.52);
  const graticule3X = -canvasWidth * 0.55;
  const graticule3Y = canvasHeight * 1.58;
  const graticule3Radius = Math.hypot(graticule3X - canvasWidth * 0.55, graticule3Y - canvasHeight * 0.3);
  const graticule = new Float32Array([
    graticule1X, graticule1Y, graticule1Radius,
    graticule1X, graticule1Y, graticule1Radius + smallerCanvasSide * 0.16,
    graticule3X, graticule3Y, graticule3Radius,
  ]);

  // Edge ticks on the site's 40px grid rhythm
  const ticks = new Path2D();
  for (let tickX = 40; tickX < canvasWidth - 1; tickX += 40) {
    const len = tickX % 120 === 0 ? 8 : 4;
    ticks.moveTo(tickX, canvasHeight);
    ticks.lineTo(tickX, canvasHeight - len);
  }
  for (let tickY = 40; tickY < canvasHeight - 1; tickY += 40) {
    const len = tickY % 120 === 0 ? 8 : 4;
    ticks.moveTo(0, tickY);
    ticks.lineTo(len, tickY);
  }

  // Twinkle character for the background field (~40% of stars, slow and gentle)
  const baseAlpha = new Float32Array(starCount);
  const twinkleAmp = new Float32Array(starCount);
  const twinkleSpeed = new Float32Array(starCount);
  const twinklePhase = new Float32Array(starCount);
  for (let k = 0; k < FIELD_STARS; k++) {
    const i = principalStarCount + k;
    baseAlpha[i] = 0.13 + (((k * 5) % 7) / 7) * 0.25;
    if (k % 5 < 2) {
      twinkleAmp[i] = baseAlpha[i] * 0.45;
      twinkleSpeed[i] = FULL_TURN_RADIANS / (4800 + ((k * 13) % 9) * 520);
      twinklePhase[i] = ((k * 11) % 12) * (FULL_TURN_RADIANS / 12);
    }
  }

  // Vega sprite: ember glow + 4 fine diffraction spikes + core, prerendered at DPR
  const ember = hexToRgb(EMBER);
  const star = hexToRgb(STAR);
  const crimson = hexToRgb(SIGNAL);
  const spikeV = 30 * starScale;
  const spikeH = 23 * starScale;
  const glowR = 30 * starScale;
  const vegaHalf = Math.ceil(spikeV + 4);
  const vega = document.createElement("canvas");
  vega.width = vegaHalf * 2 * dpr;
  vega.height = vegaHalf * 2 * dpr;
  const vegaContext = vega.getContext("2d");
  if (vegaContext) {
    vegaContext.scale(dpr, dpr);
    const glow = vegaContext.createRadialGradient(vegaHalf, vegaHalf, 0, vegaHalf, vegaHalf, glowR);
    glow.addColorStop(0, rgbString(ember, 0.5));
    glow.addColorStop(0.35, rgbString(ember, 0.16));
    glow.addColorStop(1, rgbString(ember, 0));
    vegaContext.fillStyle = glow;
    vegaContext.beginPath();
    vegaContext.arc(vegaHalf, vegaHalf, glowR, 0, FULL_TURN_RADIANS);
    vegaContext.fill();
    const spikeColor = mixRgb(ember, star, 0.55);
    vegaContext.lineWidth = 1;
    const dirs = [
      [0, -1, spikeV],
      [0, 1, spikeV],
      [-1, 0, spikeH],
      [1, 0, spikeH],
    ] as const;
    for (const [spikeX, spikeY, len] of dirs) {
      const spikeGradient = vegaContext.createLinearGradient(
        vegaHalf,
        vegaHalf,
        vegaHalf + spikeX * len,
        vegaHalf + spikeY * len,
      );
      spikeGradient.addColorStop(0, rgbString(spikeColor, 0.7));
      spikeGradient.addColorStop(1, rgbString(spikeColor, 0));
      vegaContext.strokeStyle = spikeGradient;
      vegaContext.beginPath();
      vegaContext.moveTo(vegaHalf + spikeX * 2, vegaHalf + spikeY * 2);
      vegaContext.lineTo(vegaHalf + spikeX * len, vegaHalf + spikeY * len);
      vegaContext.stroke();
    }
    vegaContext.fillStyle = rgbString(ember);
    vegaContext.beginPath();
    vegaContext.arc(vegaHalf, vegaHalf, starRadius[0], 0, FULL_TURN_RADIANS);
    vegaContext.fill();
    vegaContext.fillStyle = rgbString(mixRgb(ember, star, 0.72));
    vegaContext.beginPath();
    vegaContext.arc(vegaHalf, vegaHalf, starRadius[0] * 0.45, 0, FULL_TURN_RADIANS);
    vegaContext.fill();
  }

  // Micro-labels with precomputed per-character advances (letter-spaced mono)
  const labels: ChartLabel[] = [];
  const vegaLabel = makeLabel(ctx, LYRA[0].name!, LABEL_FONT, 1.6);
  labels.push({
    chars: vegaLabel.chars,
    advances: vegaLabel.advances,
    x: screenX[0] + 16,
    y: screenY[0] + 19,
    alpha: 0.95,
    font: LABEL_FONT,
  });
  for (const idx of [4, 5]) {
    const made = makeLabel(ctx, LYRA[idx].name!, LABEL_FONT_SMALL, 1.4);
    labels.push({
      chars: made.chars,
      advances: made.advances,
      x: screenX[idx] - made.width / 2,
      y: screenY[idx] + 17,
      alpha: 0.7,
      font: LABEL_FONT_SMALL,
    });
  }

  // Satellite lanes: gentle quadratic arcs through open sky
  const lanes: ChartLane[] = [];
  const addLane = (startX: number, startY: number, endX: number, endY: number, bulge: number) => {
    const midX = (startX + endX) / 2;
    const midY = (startY + endY) / 2;
    const laneDeltaX = endX - startX;
    const laneDeltaY = endY - startY;
    const laneDistance = Math.hypot(laneDeltaX, laneDeltaY) || 1;
    lanes.push({
      startX,
      startY,
      controlX: midX - (laneDeltaY / laneDistance) * bulge * smallerCanvasSide,
      controlY: midY + (laneDeltaX / laneDistance) * bulge * smallerCanvasSide,
      endX,
      endY,
    });
  };
  addLane(canvasWidth * 0.08, canvasHeight * 0.3, canvasWidth * 0.46, canvasHeight * 0.11, -0.05);
  addLane(canvasWidth * 0.88, canvasHeight * 0.4, canvasWidth * 0.7, canvasHeight * 0.74, -0.06);
  addLane(canvasWidth * 0.28, canvasHeight * 0.88, canvasWidth * 0.66, canvasHeight * 0.77, 0.05);

  const trailColors: string[] = [];
  for (let i = 0; i <= SATELLITE_TRAIL_LENGTH; i++) {
    trailColors.push(rgbString(mixRgb(ember, crimson, i / SATELLITE_TRAIL_LENGTH)));
  }

  return {
    starCount,
    chartX,
    chartY,
    starDelay,
    screenX,
    screenY,
    starRadius,
    isSource,
    sourceIndices,
    chart: {
      links,
      graticule,
      ticks,
      labels,
      vega,
      vegaHalf,
      twinkleAmp,
      twinkleSpeed,
      twinklePhase,
      baseAlpha,
      lanes,
      trailColors,
    },
  };
}

/**
 * One prepared scene per canvas geometry. prepareScene is deterministic for a
 * given size, so static redraws, the entrance and the ambient loop share a
 * single build. Font status is part of the key because label advances are
 * measured, so a scene built before webfonts resolve must be rebuilt after.
 */
let sceneCache:
  | {
      canvas: HTMLCanvasElement;
      width: number;
      height: number;
      dpr: number;
      fontsLoaded: boolean;
      prep: PortraitPrep;
    }
  | null = null;

export function sceneFor(layer: CanvasLayer): PortraitPrep {
  const { canvas, rect, dpr } = layer;
  const fontsLoaded = document.fonts?.status === "loaded";
  if (
    sceneCache &&
    sceneCache.canvas === canvas &&
    sceneCache.width === rect.width &&
    sceneCache.height === rect.height &&
    sceneCache.dpr === dpr &&
    sceneCache.fontsLoaded === fontsLoaded
  ) {
    return sceneCache.prep;
  }
  const prep = prepareScene(layer);
  sceneCache = {
    canvas,
    width: rect.width,
    height: rect.height,
    dpr,
    fontsLoaded,
    prep,
  };
  return prep;
}

function drawChartApparatus(layer: CanvasLayer, chart: ChartScene, alpha: number) {
  if (alpha <= 0) return;
  const { ctx } = layer;
  ctx.strokeStyle = STAR;
  ctx.globalAlpha = 0.06 * alpha;
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(
      chart.graticule[i * 3],
      chart.graticule[i * 3 + 1],
      chart.graticule[i * 3 + 2],
      0,
      FULL_TURN_RADIANS,
    );
    ctx.stroke();
  }
  ctx.globalAlpha = 0.12 * alpha;
  ctx.strokeStyle = CHART_META;
  ctx.stroke(chart.ticks);
}

// Hoisted link-progress callbacks — the animation frame loops must not allocate closures.
// The entrance reads its clock from linkElapsed, set just before the call.
const linkProgressFull = () => 1;
let linkElapsed = 0;
const linkProgressEntrance = (i: number) => clamp((linkElapsed - (520 + i * 110)) / 300);

function drawLinks(layer: CanvasLayer, chart: ChartScene, progressByLink: (i: number) => number) {
  const { ctx } = layer;
  ctx.strokeStyle = STAR;
  ctx.lineWidth = 1;
  for (let i = 0; i < chart.links.length / 4; i++) {
    const linkProgress = progressByLink(i);
    if (linkProgress <= 0) continue;
    const x1 = chart.links[i * 4];
    const y1 = chart.links[i * 4 + 1];
    const x2 = chart.links[i * 4 + 2];
    const y2 = chart.links[i * 4 + 3];
    ctx.globalAlpha = 0.3 * Math.min(1, linkProgress * 1.4);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 + (x2 - x1) * linkProgress, y1 + (y2 - y1) * linkProgress);
    ctx.stroke();
  }
}

function drawLabels(layer: CanvasLayer, chart: ChartScene, alpha: number) {
  if (alpha <= 0) return;
  const { ctx } = layer;
  ctx.fillStyle = CHART_META;
  for (const label of chart.labels) {
    ctx.font = label.font;
    ctx.globalAlpha = label.alpha * alpha;
    for (let c = 0; c < label.chars.length; c++) {
      ctx.fillText(label.chars[c], label.x + label.advances[c], label.y);
    }
  }
}

function drawVega(layer: CanvasLayer, prep: PortraitPrep, alpha: number, breathe: number) {
  const { ctx } = layer;
  const chart = prep.chart;
  const size = chart.vegaHalf * 2;
  ctx.globalAlpha = alpha * (0.92 + 0.08 * breathe);
  ctx.drawImage(
    chart.vega,
    prep.screenX[0] - chart.vegaHalf,
    prep.screenY[0] - chart.vegaHalf,
    size,
    size,
  );
}

/** Fully formed chart at rest: fallbacks, quick path, and the ambient base. */
export function drawStaticScene(layer: CanvasLayer, scene?: PortraitPrep, ambientT = -1) {
  const prep = scene ?? sceneFor(layer);
  const { ctx, rect, dpr } = layer;
  const chart = prep.chart;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  drawChartApparatus(layer, chart, 1);
  drawLinks(layer, chart, linkProgressFull);

  // Background field (twinkling when an ambient clock is supplied)
  const principalStarCount = LYRA.length;
  ctx.fillStyle = STAR;
  for (let i = principalStarCount; i < prep.starCount; i++) {
    let alpha = chart.baseAlpha[i];
    if (ambientT >= 0 && chart.twinkleAmp[i] > 0) {
      alpha += chart.twinkleAmp[i] * Math.sin(chart.twinkleSpeed[i] * ambientT + chart.twinklePhase[i]);
    }
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(prep.screenX[i], prep.screenY[i], prep.starRadius[i], 0, FULL_TURN_RADIANS);
    ctx.fill();
  }

  // Principal stars: halo + core (Vega drawn as its sprite)
  for (let i = 1; i < principalStarCount; i++) {
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    ctx.arc(prep.screenX[i], prep.screenY[i], prep.starRadius[i] * 2.1, 0, FULL_TURN_RADIANS);
    ctx.fill();
    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    ctx.arc(prep.screenX[i], prep.screenY[i], prep.starRadius[i], 0, FULL_TURN_RADIANS);
    ctx.fill();
  }
  const breathe = ambientT >= 0 ? Math.sin((ambientT / 7000) * FULL_TURN_RADIANS) : 0;
  drawVega(layer, prep, 1, breathe);
  drawLabels(layer, chart, 1);

  // Ambient satellite: a short crossing every ~9s trailing crimson→ember
  if (ambientT >= SATELLITE_FIRST_PASS) {
    const cycle = Math.floor((ambientT - SATELLITE_FIRST_PASS) / SATELLITE_PERIOD);
    const local = (ambientT - SATELLITE_FIRST_PASS) % SATELLITE_PERIOD;
    if (local < SATELLITE_DURATION) {
      const lane = chart.lanes[cycle % chart.lanes.length];
      const head = smoothstep(0, 1, local / SATELLITE_DURATION);
      for (let k = 0; k <= SATELLITE_TRAIL_LENGTH; k++) {
        const t = head - k * 0.016;
        if (t <= 0 || t >= 1) continue;
        const oneMinusT = 1 - t;
        const satelliteX =
          oneMinusT * oneMinusT * lane.startX +
          2 * oneMinusT * t * lane.controlX +
          t * t * lane.endX;
        const satelliteY =
          oneMinusT * oneMinusT * lane.startY +
          2 * oneMinusT * t * lane.controlY +
          t * t * lane.endY;
        const fade = 1 - k / SATELLITE_TRAIL_LENGTH;
        ctx.globalAlpha = fade * 0.7 * Math.sin(Math.PI * Math.min(1, head * 1.05));
        ctx.fillStyle = chart.trailColors[k];
        ctx.beginPath();
        ctx.arc(satelliteX, satelliteY, 0.7 + fade * 1.3, 0, FULL_TURN_RADIANS);
        ctx.fill();
      }
      ctx.fillStyle = STAR;
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * Entrance frame: stars fly in brightest-first, links draw, the chart
 * apparatus and labels fade up — all on the shared 2450ms clock. Vega is the
 * one exception: it fades in at rest so its spikes never smear.
 * Uses only prepared arrays — no DOM reads or allocation.
 */
export function drawSceneFrame(
  elapsed: number,
  layer: CanvasLayer,
  portrait: PortraitPrep,
  transfers: readonly { sourceIndex: number; delay: number }[],
): void {
  const { ctx, rect, dpr } = layer;
  const chart = portrait.chart;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  drawChartApparatus(layer, chart, smoothstep(650, 1250, elapsed));
  linkElapsed = elapsed;
  drawLinks(layer, chart, linkProgressEntrance);

  const { starCount, chartX, chartY, starDelay, screenX, screenY, starRadius, isSource } = portrait;
  const principalStarCount = LYRA.length;
  ctx.fillStyle = STAR;

  for (let i = 0; i < starCount; i++) {
    let arrival = (elapsed - starDelay[i]) / PORTRAIT_DOT_DURATION;
    if (arrival <= 0) continue;
    if (arrival > 1) arrival = 1;
    const eased = easeOutCubic(arrival);
    const x = screenX[i] + chartX[i] * (1 - eased);
    const y = screenY[i] + chartY[i] * (1 - eased);
    let alpha = eased < 0.85 ? eased / 0.85 : 1;

    // Edge sources: dip as transfer particles leave, reseal as the wave moves on
    if (isSource[i]) {
      let shed = 0;
      let found = false;
      for (let t = 0; t < transfers.length; t++) {
        if (transfers[t].sourceIndex !== i) continue;
        found = true;
        const local = (elapsed - transfers[t].delay) / TRANSFER_TRAVEL_DURATION;
        // Peak attenuation just as the particle departs, reseal by mid-travel
        const leave = smoothstep(0, 0.18, local) * (1 - smoothstep(0.35, 0.75, local));
        if (leave > shed) shed = leave;
      }
      if (!found) {
        const transferProgress = progress(elapsed, WINDOWS.transfer);
        shed = smoothstep(0, 0.2, transferProgress) * (1 - smoothstep(0.45, 0.85, transferProgress)) * 0.55;
      }
      alpha *= 1 - shed * 0.82;
    }

    if (i === 0) {
      drawVega(layer, portrait, alpha * eased, 0);
      ctx.fillStyle = STAR;
      continue;
    }

    if (i < principalStarCount) {
      ctx.globalAlpha = alpha * 0.22;
      ctx.beginPath();
      ctx.arc(x, y, starRadius[i] * 2.1 * (0.4 + 0.6 * eased), 0, FULL_TURN_RADIANS);
      ctx.fill();
      ctx.globalAlpha = alpha * 0.95;
    } else {
      // A touch brighter while in flight, decaying to the resting base alpha
      ctx.globalAlpha = alpha * (chart.baseAlpha[i] + 0.3 * (1 - eased));
    }
    const drawRadius = starRadius[i] * (0.18 + 0.82 * eased);
    ctx.beginPath();
    ctx.arc(x, y, drawRadius > 0.1 ? drawRadius : 0.1, 0, FULL_TURN_RADIANS);
    ctx.fill();
  }

  drawLabels(layer, chart, smoothstep(1000, 1350, elapsed));
  ctx.globalAlpha = 1;
}
