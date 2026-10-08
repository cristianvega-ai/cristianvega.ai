import { cubicPoint, type Point } from "../../motion/easing.ts";
import { LYRA } from "../../lyra/constellation.ts";
import { stagger } from "../../motion/clock.ts";
import { reportFigureLeft } from "../inset.ts";
import { labelBounds } from "../labels.ts";
import { makeGridLayer } from "../mesh.ts";
import { drawComet, drawEdge, drawLabel, drawNode, drawVegaBloom, makeRoute, type Route } from "../marks.ts";
import { smooth, FULL_TURN_RADIANS } from "../math.ts";
import { mountCanvas, type CanvasHandle, type FrameState } from "../mount.ts";
import { buildField, LYRA_EDGES, pathToVega, type FieldLayout } from "./writing-layout.ts";

// Reading field: each article is a ringed star in a star-field round Lyra, placed from its identifier.
// Faint synapses link near stars. The entrance runs field, synapses, comets, then the Vega bloom.
// A pointer or focus on an article lights its path through Lyra to Vega, and a comet runs it.
// After the entrance the picture rests, and frames run only while an article is lit.

/** Samples on the bent stretch from an article to the nearest Lyra star. */
const CURVE_STEPS = 12;
/** A lit comet repeats every CYCLE milliseconds, and runs for RUN of them. */
const CYCLE = 2700;
const RUN = 1750;
/** The resting alpha of a synapse to an article, and of a synapse between field stars. The second must not draw a hard outline. */
const LINK_ARTICLE_ALPHA = 0.15;
const LINK_FIELD_ALPHA = 0.035;
/** The Vega bloom at rest, from 0 to 1. */
const REST_BLOOM = 0.2;

interface Article {
  identifier: string;
  element: HTMLElement;
  label: string;
}

/** Read the owning list once. The page supplies each entry identifier and label. */
function readWritingBindings(container: HTMLElement): { list: HTMLElement; articles: Article[] } | null {
  const page = container.closest<HTMLElement>("[data-writing-page]");
  const list = page?.querySelector<HTMLElement>("[data-writing-list]");
  if (!list) return null;
  const articles = [...list.querySelectorAll<HTMLElement>("[data-writing-entry-identifier]")].map((element) => ({
    identifier: element.dataset.writingEntryIdentifier!,
    element,
    label: element.querySelector("[data-writing-label]")?.textContent?.trim() ?? "",
  }));
  return { list, articles };
}

export function mountWriting(container: HTMLElement): CanvasHandle | null {
  const bindings = readWritingBindings(container);
  if (!bindings) return null;
  const { list, articles } = bindings;
  const count = articles.length;
  if (!count) return null;

  let field: FieldLayout | undefined;
  let grid: HTMLCanvasElement | null = null;
  let routes: Route[] = [];
  let entrance: number[] = [];
  // The box, in canvas pixels, that no article text covers.
  let originX = 0;
  let boxWidth = 0;
  let boxHeight = 0;

  // The state of the lit article. `weights` ease toward 1 for the lit article and 0 for the rest.
  const weights = new Float32Array(count);
  let active = -1;
  let since = 0;
  let previousTime = 0;
  const scratch: Point = { x: 0, y: 0 };
  const start: Point = { x: 0, y: 0 };
  const control: Point = { x: 0, y: 0 };
  const end: Point = { x: 0, y: 0 };

  // Rebuild the layout from the measured box. The list, when it sits beside the graphic, takes the left part.
  function build(state: FrameState) {
    const box = container.getBoundingClientRect();
    const listBox = list.getBoundingClientRect();
    const beside = listBox.top < box.bottom - 1 && listBox.bottom > box.top + 1;
    originX = beside ? Math.min(Math.max(0, listBox.right - box.left), state.width * 0.6) : 0;
    boxWidth = state.width - originX;
    boxHeight = state.height;
    reportFigureLeft(container, boxWidth, boxHeight, originX);
    field = buildField({
      articleIdentifiers: articles.map((article) => article.identifier),
      labels: articles.map((article) => article.label),
      labelWidthsInPixels: articles.map((article) => state.labelFont.widthInPixels(article.label)),
      starWidthsInPixels: LYRA.map((star) => star.name ? state.labelFont.widthInPixels(star.name) : 0),
      lineHeightInPixels: state.labelFont.lineHeightInPixels,
      width: boxWidth,
      height: boxHeight,
      bounds: labelBounds(container, state.width, state.height, originX),
    });
    grid = makeGridLayer(boxWidth, boxHeight, state.ratio, state.palette);
    const { stars, points } = field;

    // A route: the article, a bent path to the nearest Lyra star, then along the figure to Vega.
    routes = articles.map((_, i) => {
      const p = points[i];
      let nearest = 1;
      let nearestDistance = Infinity;
      for (let k = 1; k < stars.length; k++) {
        const d = Math.hypot(stars[k].x - p.x, stars[k].y - p.y);
        if (d < nearestDistance) {
          nearestDistance = d;
          nearest = k;
        }
      }
      const target = stars[nearest];
      const bend = (i % 2 ? 1 : -1) * 0.16;
      start.x = p.x;
      start.y = p.y;
      end.x = target.x;
      end.y = target.y;
      control.x = (p.x + target.x) / 2 - (target.y - p.y) * bend;
      control.y = (p.y + target.y) / 2 + (target.x - p.x) * bend;
      const route: Point[] = [];
      for (let k = 0; k < CURVE_STEPS; k++) {
        cubicPoint(scratch, k / CURVE_STEPS, start, control, control, end);
        route.push({ x: scratch.x, y: scratch.y });
      }
      for (const node of pathToVega(nearest, LYRA_EDGES, stars.length)) route.push(stars[node]);
      return makeRoute(route);
    });
    entrance = [0, 3, 5, count - 1].filter((v, i, all) => v < count && all.indexOf(v) === i);
  }

  // Ease the weights toward the lit article. `snap` jumps to the end, for reduced motion.
  function ease(elapsedMilliseconds: number, snap: boolean): number {
    const k = snap ? 1 : 1 - Math.exp(-elapsedMilliseconds / 120);
    let any = 0;
    for (let i = 0; i < count; i++) {
      weights[i] += ((i === active ? 1 : 0) - weights[i]) * k;
      any = Math.max(any, weights[i]);
    }
    return any;
  }

  function draw(drawingContext: CanvasRenderingContext2D, state: FrameState) {
    if (!field) return;
    const { stars, points, links, articleLabels, starLabels } = field;
    const p = state.progress;
    const palette = state.palette;
    const glow = state.glow;
    const t = state.activeTime;
    const any = ease(Math.max(0, Math.min(64, t - previousTime)), state.reduced);
    previousTime = t;
    const dim = 1 - 0.6 * any;
    drawingContext.save();
    drawingContext.translate(originX, 0);

    // The site grid, with the same fade as on the other pages.
    if (grid) {
      drawingContext.globalAlpha = smooth(p / 0.3);
      drawingContext.drawImage(grid, 0, 0, boxWidth, boxHeight);
      drawingContext.globalAlpha = 1;
    }

    // Field stars fade in with the entrance, then hold still.
    const fieldIn = smooth(p / 0.45);
    drawingContext.fillStyle = palette.metadata;
    for (let i = count; i < points.length; i++) {
      const q = points[i];
      drawingContext.globalAlpha = fieldIn * q.alpha * Math.sqrt(dim);
      drawingContext.beginPath();
      drawingContext.arc(q.x, q.y, q.radius, 0, FULL_TURN_RADIANS);
      drawingContext.fill();
    }
    drawingContext.globalAlpha = 1;

    // Synapses draw in, then rest faint. The figure's own links come after them.
    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      const a = points[link.from];
      const b = points[link.to];
      drawEdge(drawingContext, palette, a.x, a.y, b.x, b.y, stagger(p, 0.06 + (i % 9) * 0.03, 0.26), false, (link.weight ? LINK_ARTICLE_ALPHA : LINK_FIELD_ALPHA) * dim);
    }
    for (let i = 0; i < LYRA_EDGES.length; i++) {
      const a = stars[LYRA_EDGES[i][0]];
      const b = stars[LYRA_EDGES[i][1]];
      drawEdge(drawingContext, palette, a.x, a.y, b.x, b.y, stagger(p, 0.3 + i * 0.05, 0.2), true, 0.5);
    }

    // The lit article: its path to Vega, with a halo on every star it crosses.
    for (let i = 0; i < count; i++) {
      const v = weights[i];
      if (v < 0.01) continue;
      const route = routes[i];
      drawingContext.lineCap = "round";
      drawingContext.lineJoin = "round";
      drawingContext.strokeStyle = palette.sky;
      drawingContext.globalAlpha = 0.9 * v;
      drawingContext.lineWidth = 1.2;
      drawingContext.beginPath();
      drawingContext.moveTo(route.xs[0], route.ys[0]);
      for (let k = 1; k < route.xs.length; k++) drawingContext.lineTo(route.xs[k], route.ys[k]);
      drawingContext.stroke();
      drawingContext.globalAlpha = v;
      for (let k = CURVE_STEPS; k < route.xs.length; k++) {
        const reach = k === route.xs.length - 1 ? 22 : 9;
        drawingContext.drawImage(glow, route.xs[k] - reach, route.ys[k] - reach, reach * 2, reach * 2);
      }
      drawingContext.globalAlpha = 1;
    }

    // Article stars: a core and a thin ring, so they read as articles and not as filler.
    for (let i = 0; i < count; i++) {
      const q = points[i];
      const v = weights[i];
      const g = stagger(p, 0.1 + i * 0.03, 0.2);
      drawNode(drawingContext, palette, glow, q.x, q.y, 2.6, g, v > 0.3, 1, false);
      if (g > 0) {
        drawingContext.strokeStyle = v > 0.05 ? palette.sky : palette.metadata;
        drawingContext.lineWidth = 0.7;
        drawingContext.globalAlpha = (0.32 + 0.5 * v) * g;
        drawingContext.beginPath();
        drawingContext.arc(q.x, q.y, 6 + 3 * v, 0, FULL_TURN_RADIANS);
        drawingContext.stroke();
        drawingContext.globalAlpha = 1;
      }
    }
    for (let i = 0; i < stars.length; i++) {
      const star = stars[i];
      drawNode(drawingContext, palette, glow, star.x, star.y, star.vega ? 3 : 2.5, stagger(p, 0.32 + i * 0.05, 0.16), true, 0.95, star.vega);
    }

    // Comets and the Vega bloom. Reduced motion shows the resting bloom and no comet.
    let bloom = REST_BLOOM;
    let ping = 0;
    if (!state.reduced) {
      let pulse = 0;
      if (p < 1) {
        for (let k = 0; k < entrance.length; k++) {
          const travel = stagger(p, 0.36 + k * 0.1, 0.36);
          drawComet(drawingContext, palette, glow, routes[entrance[k]], travel, 70);
          if (travel > 0.86 && travel < 1) ping = Math.max(ping, (travel - 0.86) / 0.14);
        }
        pulse = smooth((p - 0.6) / 0.25) * (1 - smooth((p - 0.88) / 0.12)) * 0.9;
      } else if (active >= 0) {
        const phase = (t - since) % CYCLE;
        const travel = phase < RUN ? phase / RUN : 0;
        drawComet(drawingContext, palette, glow, routes[active], travel, 70);
        if (travel > 0.8) {
          ping = (travel - 0.8) / 0.2;
          pulse = smooth((travel - 0.8) / 0.12) * (1 - smooth((travel - 0.95) / 0.05));
        }
      }
      bloom = Math.max(pulse, REST_BLOOM * smooth((p - 0.85) / 0.15));
    }
    drawVegaBloom(drawingContext, glow, stars[0].x, stars[0].y, bloom);
    if (ping > 0) {
      drawingContext.strokeStyle = palette.sky;
      drawingContext.lineWidth = 0.7;
      drawingContext.globalAlpha = 0.5 * (1 - ping);
      drawingContext.beginPath();
      drawingContext.arc(stars[0].x, stars[0].y, 10 + 22 * ping, 0, FULL_TURN_RADIANS);
      drawingContext.stroke();
      drawingContext.globalAlpha = 1;
    }

    // Labels. A lit article repeats its label in the text colour.
    const labelIn = smooth((p - 0.2) / 0.2);
    const starIn = smooth((p - 0.72) / 0.2);
    for (let i = 0; i < count; i++) {
      const label = articleLabels[i];
      drawLabel(drawingContext, palette, state.labelFont.canvasFont, label.text, label.x, label.y, label.align, labelIn);
      const v = weights[i];
      if (v > 0.02) {
        drawingContext.globalAlpha = v * labelIn;
        drawingContext.fillStyle = palette.text;
        drawingContext.fillText(label.text, label.x, label.y);
        drawingContext.globalAlpha = 1;
      }
    }
    for (let i = 0; i < starLabels.length; i++) {
      const label = starLabels[i];
      if (label) drawLabel(drawingContext, palette, state.labelFont.canvasFont, label.text, label.x, label.y, label.align, starIn);
    }
    drawingContext.restore();

    // Ask for frames only while an article is lit or its glow still fades.
    return !state.reduced && (active >= 0 || any >= 0.01);
  }

  // Pointer and focus on an article light it. The container attribute changes once for each change of article.
  function attach(canvasHandle: CanvasHandle) {
    const events = new AbortController();
    const options = { signal: events.signal };

    function select(index: number) {
      if (index === active) return;
      active = index;
      since = canvasHandle.state.activeTime;
      if (index >= 0) container.dataset.activeArticle = articles[index].identifier;
      else delete container.dataset.activeArticle;
      // Reduced motion runs no frames, so the change draws at once.
      if (canvasHandle.state.reduced) canvasHandle.redraw();
      else canvasHandle.wake();
    }

    articles.forEach((article, index) => {
      article.element.addEventListener("pointerenter", () => select(index), options);
      article.element.addEventListener("focusin", () => select(index), options);
      article.element.addEventListener(
        "pointerleave",
        () => {
          select(articles.findIndex((other) => other.element.contains(container.ownerDocument.activeElement)));
        },
        options,
      );
      article.element.addEventListener("focusout", () => select(-1), options);
    });

    return () => {
      events.abort();
      // A restored page starts with no lit article.
      active = -1;
      weights.fill(0);
      delete container.dataset.activeArticle;
    };
  }

  return mountCanvas(container, { draw, onResize: build, attach });
}
