import { clamp, cubicPoint, FULL_TURN_RADIANS, progress, smoothstep, type Point } from "./easing";
import type { CanvasLayer, Layout } from "./layout";
import { drawSceneFrame, sceneFor, SIGNAL, STAR, type PortraitPrep } from "./star-chart";
import {
  TARGET_WINDOWS,
  TRANSFER_TRAVEL_DURATION,
  WINDOWS,
  type TargetBinding,
  type TargetKind,
} from "./timeline";

export const MAX_TRANSFER_SOURCES = 96;
export const MAX_COPY_PARTICLES = 2800;
export const MAX_BUTTON_PERIMETER = 48;

export type CopyParticle = {
  x: number;
  y: number;
  r: number;
  color: string;
  kind: "text" | "highlight" | "button-label" | "button-perimeter";
  target: TargetKind;
};

export type TransferParticle = {
  start: Point;
  control1: Point;
  control2: Point;
  end: Point;
  r: number;
  color: string;
  delay: number;
  sourceIndex: number;
};

export type MotionPrep = {
  portrait: PortraitPrep;
  copy: CopyParticle[];
  transfers: TransferParticle[];
};

// Reused per frame — never allocate points inside the animation frame loop
const _cubicOut: Point = { x: 0, y: 0 };

function transformGlyph(ch: string, textTransform: string): string {
  if (textTransform === "uppercase") return ch.toUpperCase();
  if (textTransform === "lowercase") return ch.toLowerCase();
  return ch;
}

// One CPU-readable scratch canvas for the whole glyph sampling pass, grown to
// fit the largest glyph, instead of a canvas and a context per character.
let glyphCanvas: HTMLCanvasElement | null = null;
let glyphCtx: CanvasRenderingContext2D | null = null;

function glyphScratch(w: number, h: number): CanvasRenderingContext2D | null {
  let canvas = glyphCanvas;
  if (!canvas) {
    canvas = document.createElement("canvas");
    glyphCanvas = canvas;
    glyphCtx = canvas.getContext("2d", { willReadFrequently: true });
  }
  const ctx = glyphCtx;
  if (!ctx) return null;
  if (canvas.width < w || canvas.height < h) {
    // Resizing also clears; per-glyph font and fill style are set by the caller
    canvas.width = Math.max(canvas.width, w);
    canvas.height = Math.max(canvas.height, h);
  }
  ctx.clearRect(0, 0, w, h);
  return ctx;
}

/**
 * Sample glyph ink from real DOM text into host-local particles (once).
 * Skips nested motion targets so parent/child targets do not double-sample.
 * Optional colorOverride paints highlight glyphs in crimson.
 */
function sampleTextElement(
  el: Element,
  hostRect: DOMRect,
  target: TargetKind,
  out: CopyParticle[],
  budget: { remaining: number },
  colorOverride?: string,
): void {
  if (budget.remaining <= 0) return;

  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let node: Node | null;
  const kind: CopyParticle["kind"] = target === "highlight" ? "highlight" : "text";

  while ((node = walker.nextNode()) && budget.remaining > 0) {
    const raw = node.nodeValue;
    if (!raw || !raw.trim()) continue;
    const parent = (node as Text).parentElement;
    if (!parent) continue;
    // Nested targets (e.g. highlight under a name host) are prepared separately
    const nested = parent.closest("[data-motion-target]");
    if (nested && nested !== el) continue;

    const computedStyle = getComputedStyle(parent);
    const font = `${computedStyle.fontWeight} ${computedStyle.fontSize} ${computedStyle.fontFamily}`;
    const color = colorOverride || computedStyle.color;
    const textTransform = computedStyle.textTransform;
    const fontSize = parseFloat(computedStyle.fontSize);
    const STEP = Math.round(clamp(fontSize * 0.09, 2, 6));
    const sampleRadius = STEP * 0.46;

    for (let i = 0; i < raw.length && budget.remaining > 0; i++) {
      if (raw[i] === " ") continue;
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const rects = range.getClientRects();
      if (!rects.length) continue;
      const glyphRect = rects[0];
      if (!glyphRect.width || !glyphRect.height) continue;

      const glyphWidth = Math.ceil(glyphRect.width);
      const glyphHeight = Math.ceil(glyphRect.height);
      const offscreen = glyphScratch(glyphWidth, glyphHeight);
      if (!offscreen) continue;

      offscreen.font = font;
      offscreen.textBaseline = "alphabetic";
      offscreen.fillStyle = "#000";
      const glyph = transformGlyph(raw[i], textTransform);
      const metrics = offscreen.measureText(glyph);
      const ascent = metrics.actualBoundingBoxAscent || fontSize * 0.72;
      const descent = metrics.actualBoundingBoxDescent || fontSize * 0.2;
      const glyphBaselineY = (glyphHeight - (ascent + descent)) / 2 + ascent;
      offscreen.fillText(glyph, 0, glyphBaselineY);
      const pixels = offscreen.getImageData(0, 0, glyphWidth, glyphHeight).data;
      const boxX = glyphRect.left - hostRect.left;
      const boxY = glyphRect.top - hostRect.top;

      for (let y = 0; y < glyphHeight && budget.remaining > 0; y += STEP) {
        for (let x = 0; x < glyphWidth && budget.remaining > 0; x += STEP) {
          if (pixels[(y * glyphWidth + x) * 4 + 3] > 110) {
            out.push({
              x: boxX + x,
              y: boxY + y,
              color,
              r: sampleRadius,
              kind,
              target,
            });
            budget.remaining -= 1;
          }
        }
      }
    }
  }
}

function perimeterPoints(box: DOMRect, hostRect: DOMRect, spacing: number): Point[] {
  const left = box.left - hostRect.left;
  const top = box.top - hostRect.top;
  const boxWidth = box.width;
  const boxHeight = box.height;
  const points: Point[] = [];
  if (boxWidth <= 0 || boxHeight <= 0) return points;

  const push = (x: number, y: number) => {
    points.push({ x, y });
  };

  // Top edge L→R
  for (let x = 0; x <= boxWidth; x += spacing) push(left + x, top);
  // Right edge T→B (skip corners already covered)
  for (let y = spacing; y < boxHeight; y += spacing) push(left + boxWidth, top + y);
  // Bottom edge R→L
  for (let x = boxWidth; x >= 0; x -= spacing) push(left + x, top + boxHeight);
  // Left edge B→T
  for (let y = boxHeight - spacing; y > 0; y -= spacing) push(left, top + y);

  // Cap total perimeter samples
  if (points.length > MAX_BUTTON_PERIMETER) {
    const stride = Math.ceil(points.length / MAX_BUTTON_PERIMETER);
    const capped: Point[] = [];
    for (let i = 0; i < points.length && capped.length < MAX_BUTTON_PERIMETER; i += stride) {
      capped.push(points[i]);
    }
    return capped;
  }
  return points;
}

function collectButtonParticles(
  el: HTMLElement,
  hostRect: DOMRect,
  target: "primary-action" | "secondary-action",
  out: CopyParticle[],
  budget: { remaining: number },
): void {
  const computedStyle = getComputedStyle(el);
  const labelColor = computedStyle.color || STAR;
  const borderColor = computedStyle.borderColor || STAR;

  // Label glyphs only — not a solid rectangle fill
  const before = out.length;
  sampleTextElement(el, hostRect, target, out, budget);
  for (let i = before; i < out.length; i++) {
    out[i].kind = "button-label";
    out[i].color = labelColor;
  }

  const box = el.getBoundingClientRect();
  const spacing = Math.max(6, Math.min(box.width, box.height) / 12);
  const ring = perimeterPoints(box, hostRect, spacing);
  const perimeterRadius = Math.min(2.4, spacing * 0.35);
  const ringColor = target === "primary-action" ? SIGNAL : borderColor;

  for (let i = 0; i < ring.length && budget.remaining > 0; i++) {
    out.push({
      x: ring[i].x,
      y: ring[i].y,
      r: perimeterRadius,
      color: ringColor,
      kind: "button-perimeter",
      target,
    });
    budget.remaining -= 1;
  }
}

function collectTextParticles(root: HTMLElement, layout: Layout): CopyParticle[] {
  const main = root.querySelector<HTMLElement>(".hero__main");
  const grid = root.querySelector<HTMLElement>(".hero__grid");
  if (!main || !grid) return [];

  // Sample in main page space relative to main, then lift into grid-local space
  // so particles align with the full-grid copy canvas (unclipped transfers).
  const hostRect = main.getBoundingClientRect();
  const gridPage = grid.getBoundingClientRect();
  const offsetX = hostRect.left - gridPage.left - layout.copy.rect.left;
  const offsetY = hostRect.top - gridPage.top - layout.copy.rect.top;

  const copy: CopyParticle[] = [];
  const budget = { remaining: MAX_COPY_PARTICLES };

  const eyebrow = root.querySelector<HTMLElement>('[data-motion-target="eyebrow"]');
  const name = root.querySelector<HTMLElement>('[data-motion-target="name"]');
  const highlight = root.querySelector<HTMLElement>('[data-motion-target="highlight"]');
  const subhead = root.querySelector<HTMLElement>('[data-motion-target="subhead"]');
  const primary = root.querySelector<HTMLElement>('[data-motion-target="primary-action"]');
  const secondary = root.querySelector<HTMLElement>('[data-motion-target="secondary-action"]');

  if (eyebrow) sampleTextElement(eyebrow, hostRect, "eyebrow", copy, budget);
  if (name) sampleTextElement(name, hostRect, "name", copy, budget);
  // Vega forms from crimson glyph dots; the DOM reveal supplies the gradient fill
  if (highlight) {
    sampleTextElement(highlight, hostRect, "highlight", copy, budget, SIGNAL);
  }
  if (subhead) sampleTextElement(subhead, hostRect, "subhead", copy, budget);

  if (primary) collectButtonParticles(primary, hostRect, "primary-action", copy, budget);
  if (secondary) collectButtonParticles(secondary, hostRect, "secondary-action", copy, budget);

  if (offsetX !== 0 || offsetY !== 0) {
    for (let i = 0; i < copy.length; i++) {
      copy[i].x += offsetX;
      copy[i].y += offsetY;
    }
  }

  return copy;
}

/**
 * Pair right-band field stars with copy destinations; build cubic paths once.
 * Stars are fewer than destinations, so each source star emits several
 * staggered particles — starlight streaming across the seam into the copy.
 * Coordinates are grid-local (full-grid copy canvas).
 */
function prepareTransferParticles(
  portrait: PortraitPrep,
  copy: CopyParticle[],
  layout: Layout,
): TransferParticle[] {
  if (!portrait.sourceIndices.length || !copy.length) return [];

  // Portrait layer origin within the shared grid-sized copy canvas
  const originX = layout.portrait.rect.left - layout.copy.rect.left;
  const originY = layout.portrait.rect.top - layout.copy.rect.top;

  // Destinations ordered for stable pairing (top-to-bottom, then left-to-right)
  const destOrder = copy
    .map((_, i) => i)
    .sort((a, b) => copy[a].y - copy[b].y || copy[a].x - copy[b].x);

  const sources = portrait.sourceIndices;
  const transfers: TransferParticle[] = [];
  const transferCount = Math.min(MAX_TRANSFER_SOURCES, destOrder.length);

  for (let i = 0; i < transferCount; i++) {
    const sourceIndex = sources[i % sources.length];
    const destinationIndex = destOrder[Math.floor((i / transferCount) * destOrder.length)];
    const dest = copy[destinationIndex];

    const start: Point = {
      x: originX + portrait.screenX[sourceIndex],
      y: originY + portrait.screenY[sourceIndex],
    };
    const end: Point = { x: dest.x, y: dest.y };
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    // Mild arc perpendicular to travel — L→R desktop, T→B stacked both work
    const len = Math.hypot(deltaX, deltaY) || 1;
    const arc = (0.08 + (i % 5) * 0.02) * len * (i % 2 === 0 ? 1 : -1);
    const normalX = -deltaY / len;
    const normalY = deltaX / len;

    const control1: Point = {
      x: start.x + deltaX * 0.32 + normalX * arc,
      y: start.y + deltaY * 0.32 + normalY * arc,
    };
    const control2: Point = {
      x: start.x + deltaX * 0.68 + normalX * arc * 0.55,
      y: start.y + deltaY * 0.68 + normalY * arc * 0.55,
    };

    // Stagger within transfer window 450–1450ms
    transfers.push({
      start,
      control1,
      control2,
      end,
      r: Math.max(0.8, Math.min(portrait.starRadius[sourceIndex] + 0.6, dest.r)),
      color: dest.color,
      delay: WINDOWS.transfer[0] + (i / Math.max(1, transferCount - 1)) * 400 + Math.random() * 120,
      sourceIndex,
    });
  }

  return transfers;
}

/**
 * Full particle preparation after fonts/layout are ready.
 * Returns null if required targets produced no usable masks.
 */
export function prepareMotion(root: HTMLElement, layout: Layout): MotionPrep | null {
  const portrait = sceneFor(layout.portrait);
  const copy = collectTextParticles(root, layout);

  // Require core copy masks; name/eyebrow text and Vega highlight glyphs both count
  const hasText = copy.some((particle) => particle.kind === "text" || particle.kind === "highlight");
  if (!hasText) return null;

  const transfers = prepareTransferParticles(portrait, copy, layout);

  return { portrait, copy, transfers };
}

/**
 * Traveling transfer particles + landed target particles with coverage-driven fade.
 */
function drawCopyFrame(
  elapsed: number,
  layer: CanvasLayer,
  prep: MotionPrep,
): void {
  const { ctx, rect, dpr } = layer;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  let lastColor = "";

  // 1) Traveling particles on cubic paths
  const transfers = prep.transfers;
  for (let i = 0; i < transfers.length; i++) {
    const transfer = transfers[i];
    let t = (elapsed - transfer.delay) / TRANSFER_TRAVEL_DURATION;
    if (t <= 0 || t >= 1) continue;
    const easedT = smoothstep(0, 1, t);
    cubicPoint(_cubicOut, easedT, transfer.start, transfer.control1, transfer.control2, transfer.end);
    // Soft in at start; soft out near landing so landed particles take over
    const travelAlpha =
      t < 0.12 ? t / 0.12 : t > 0.78 ? (1 - t) / 0.22 : 1;
    if (travelAlpha < 0.02) continue;
    if (transfer.color !== lastColor) {
      ctx.fillStyle = transfer.color;
      lastColor = transfer.color;
    }
    ctx.globalAlpha = travelAlpha;
    const drawRadius = transfer.r * (0.7 + 0.3 * (1 - easedT));
    ctx.beginPath();
    ctx.arc(_cubicOut.x, _cubicOut.y, drawRadius > 0.15 ? drawRadius : 0.15, 0, FULL_TURN_RADIANS);
    ctx.fill();
  }

  // 2) Landed target particles — form then shrink/fade as DOM takes over.
  // Alpha and radius follow the target window alone, so runs of particles that
  // share colour, alpha and radius batch into one path and one fill. The grid
  // step exceeds the particle diameter, so the batched path covers the pixels
  // the per-particle fills covered, at a fraction of the rasterisation cost.
  const copy = prep.copy;
  lastColor = "";
  let batchAlpha = -1;
  let batchRadius = -1;
  let batched = false;
  for (let i = 0; i < copy.length; i++) {
    const particle = copy[i];
    const coverage = progress(elapsed, TARGET_WINDOWS[particle.target]);
    if (coverage <= 0) continue;
    const appear = smoothstep(0, 0.38, coverage);
    const particleOpacity = 1 - smoothstep(0.5, 1, coverage);
    const alpha = appear * particleOpacity;
    if (alpha < 0.02) continue;
    const scaled = particle.r * (1 - 0.62 * smoothstep(0.45, 1, coverage));
    const radius = scaled > 0.12 ? scaled : 0.12;
    if (
      batched &&
      (particle.color !== lastColor || alpha !== batchAlpha || radius !== batchRadius)
    ) {
      ctx.fill();
      batched = false;
    }
    if (!batched) {
      ctx.fillStyle = particle.color;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      lastColor = particle.color;
      batchAlpha = alpha;
      batchRadius = radius;
      batched = true;
    }
    // moveTo starts a fresh subpath so circles are not joined by chords
    ctx.moveTo(particle.x + radius, particle.y);
    ctx.arc(particle.x, particle.y, radius, 0, FULL_TURN_RADIANS);
  }
  if (batched) ctx.fill();
  ctx.globalAlpha = 1;
}

export function isActionTarget(kind: TargetKind): boolean {
  return kind === "primary-action" || kind === "secondary-action";
}

/** Progressive per-target DOM handoff — no global finish() cross-fade. */
export function updateDomReveal(elapsed: number, targets: TargetBinding[]): void {
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const coverage = progress(elapsed, target.window);
    const domOpacity = smoothstep(0.28, 0.92, coverage);
    // Buttons: form fill/border/label via --motion-reveal (not element opacity)
    // so they are not translucent solid slabs over particles.
    if (isActionTarget(target.kind)) {
      target.element.style.setProperty("--motion-reveal", String(domOpacity));
      target.element.style.opacity = "1";
    } else {
      target.element.style.opacity = String(domOpacity);
    }
  }
}

/**
 * Single animation frame: clear both canvases, draw chart + copy, update DOM.
 * No DOM measurement, no createElement, no array allocation.
 */
export function drawFrame(
  elapsed: number,
  layout: Layout,
  prep: MotionPrep,
  targets: TargetBinding[],
): void {
  drawSceneFrame(elapsed, layout.portrait, prep.portrait, prep.transfers);
  drawCopyFrame(elapsed, layout.copy, prep);
  updateDomReveal(elapsed, targets);
}

export function collectTargetBindings(root: HTMLElement): TargetBinding[] {
  const kinds: TargetKind[] = [
    "eyebrow",
    "name",
    "highlight",
    "subhead",
    "primary-action",
    "secondary-action",
  ];
  const bindings: TargetBinding[] = [];
  for (let i = 0; i < kinds.length; i++) {
    const kind = kinds[i];
    const element = root.querySelector<HTMLElement>(`[data-motion-target="${kind}"]`);
    if (element) bindings.push({ element, kind, window: TARGET_WINDOWS[kind] });
  }
  return bindings;
}

export function hideMotionTargets(targets: TargetBinding[]): void {
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    if (isActionTarget(target.kind)) {
      // Visible box; fill/border/label gated by --motion-reveal + playing CSS
      target.element.style.opacity = "1";
      target.element.style.setProperty("--motion-reveal", "0");
    } else {
      target.element.style.opacity = "0";
    }
  }
}
