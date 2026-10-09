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
  const articleCount = articles.length;
  if (!articleCount) return null;

  let field: FieldLayout | undefined;
  let grid: HTMLCanvasElement | null = null;
  let routes: Route[] = [];
  let entranceArticleIndices: number[] = [];
  // The box, in canvas pixels, that no article text covers.
  let originX = 0;
  let boxWidth = 0;
  let boxHeight = 0;

  // The state of the lit article. `weights` ease toward 1 for the lit article and 0 for the rest.
  const weights = new Float32Array(articleCount);
  let activeArticleIndex = -1;
  let selectionStartTime = 0;
  let previousActiveTime = 0;
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
    routes = articles.map((_, articleIndex) => {
      const articlePoint = points[articleIndex];
      let nearestStarIndex = 1;
      let nearestDistance = Infinity;
      for (let starIndex = 1; starIndex < stars.length; starIndex++) {
        const distance = Math.hypot(stars[starIndex].x - articlePoint.x, stars[starIndex].y - articlePoint.y);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestStarIndex = starIndex;
        }
      }
      const target = stars[nearestStarIndex];
      const bend = (articleIndex % 2 ? 1 : -1) * 0.16;
      start.x = articlePoint.x;
      start.y = articlePoint.y;
      end.x = target.x;
      end.y = target.y;
      control.x = (articlePoint.x + target.x) / 2 - (target.y - articlePoint.y) * bend;
      control.y = (articlePoint.y + target.y) / 2 + (target.x - articlePoint.x) * bend;
      const route: Point[] = [];
      for (let sampleIndex = 0; sampleIndex < CURVE_STEPS; sampleIndex++) {
        cubicPoint(scratch, sampleIndex / CURVE_STEPS, start, control, control, end);
        route.push({ x: scratch.x, y: scratch.y });
      }
      for (const starIndex of pathToVega(nearestStarIndex, LYRA_EDGES, stars.length)) route.push(stars[starIndex]);
      return makeRoute(route);
    });
    entranceArticleIndices = [0, 3, 5, articleCount - 1].filter(
      (articleIndex, index, indices) => articleIndex < articleCount && indices.indexOf(articleIndex) === index,
    );
  }

  // Ease the weights toward the lit article. `snap` jumps to the end, for reduced motion.
  function easeWeights(elapsedMilliseconds: number, snap: boolean): number {
    const easingShare = snap ? 1 : 1 - Math.exp(-elapsedMilliseconds / 120);
    let maximumWeight = 0;
    for (let articleIndex = 0; articleIndex < articleCount; articleIndex++) {
      weights[articleIndex] += ((articleIndex === activeArticleIndex ? 1 : 0) - weights[articleIndex]) * easingShare;
      maximumWeight = Math.max(maximumWeight, weights[articleIndex]);
    }
    return maximumWeight;
  }

  function drawBackground(
    drawingContext: CanvasRenderingContext2D,
    state: FrameState,
    layout: FieldLayout,
    backgroundStrength: number,
  ) {
    if (grid) {
      drawingContext.globalAlpha = smooth(state.progress / 0.3);
      drawingContext.drawImage(grid, 0, 0, boxWidth, boxHeight);
      drawingContext.globalAlpha = 1;
    }

    const fieldProgress = smooth(state.progress / 0.45);
    drawingContext.fillStyle = state.palette.metadata;
    for (let pointIndex = articleCount; pointIndex < layout.points.length; pointIndex++) {
      const point = layout.points[pointIndex];
      drawingContext.globalAlpha = fieldProgress * point.alpha * Math.sqrt(backgroundStrength);
      drawingContext.beginPath();
      drawingContext.arc(point.x, point.y, point.radius, 0, FULL_TURN_RADIANS);
      drawingContext.fill();
    }
    drawingContext.globalAlpha = 1;
  }

  function drawLinks(
    drawingContext: CanvasRenderingContext2D,
    state: FrameState,
    layout: FieldLayout,
    backgroundStrength: number,
  ) {
    for (let linkIndex = 0; linkIndex < layout.links.length; linkIndex++) {
      const link = layout.links[linkIndex];
      const from = layout.points[link.from];
      const to = layout.points[link.to];
      drawEdge(
        drawingContext,
        state.palette,
        from.x,
        from.y,
        to.x,
        to.y,
        stagger(state.progress, 0.06 + (linkIndex % 9) * 0.03, 0.26),
        false,
        (link.weight ? LINK_ARTICLE_ALPHA : LINK_FIELD_ALPHA) * backgroundStrength,
      );
    }
    for (let edgeIndex = 0; edgeIndex < LYRA_EDGES.length; edgeIndex++) {
      const from = layout.stars[LYRA_EDGES[edgeIndex][0]];
      const to = layout.stars[LYRA_EDGES[edgeIndex][1]];
      drawEdge(
        drawingContext,
        state.palette,
        from.x,
        from.y,
        to.x,
        to.y,
        stagger(state.progress, 0.3 + edgeIndex * 0.05, 0.2),
        true,
        0.5,
      );
    }
  }

  function drawSelectionPaths(drawingContext: CanvasRenderingContext2D, state: FrameState) {
    for (let articleIndex = 0; articleIndex < articleCount; articleIndex++) {
      const weight = weights[articleIndex];
      if (weight < 0.01) continue;
      const route = routes[articleIndex];
      drawingContext.lineCap = "round";
      drawingContext.lineJoin = "round";
      drawingContext.strokeStyle = state.palette.sky;
      drawingContext.globalAlpha = 0.9 * weight;
      drawingContext.lineWidth = 1.2;
      drawingContext.beginPath();
      drawingContext.moveTo(route.xs[0], route.ys[0]);
      for (let pointIndex = 1; pointIndex < route.xs.length; pointIndex++) {
        drawingContext.lineTo(route.xs[pointIndex], route.ys[pointIndex]);
      }
      drawingContext.stroke();
      drawingContext.globalAlpha = weight;
      for (let pointIndex = CURVE_STEPS; pointIndex < route.xs.length; pointIndex++) {
        const reach = pointIndex === route.xs.length - 1 ? 22 : 9;
        drawingContext.drawImage(
          state.glow,
          route.xs[pointIndex] - reach,
          route.ys[pointIndex] - reach,
          reach * 2,
          reach * 2,
        );
      }
      drawingContext.globalAlpha = 1;
    }
  }

  function drawStars(drawingContext: CanvasRenderingContext2D, state: FrameState, layout: FieldLayout) {
    for (let articleIndex = 0; articleIndex < articleCount; articleIndex++) {
      const point = layout.points[articleIndex];
      const weight = weights[articleIndex];
      const growth = stagger(state.progress, 0.1 + articleIndex * 0.03, 0.2);
      drawNode(
        drawingContext,
        state.palette,
        state.glow,
        point.x,
        point.y,
        2.6,
        growth,
        weight > 0.3,
        1,
        false,
      );
      if (growth > 0) {
        drawingContext.strokeStyle = weight > 0.05 ? state.palette.sky : state.palette.metadata;
        drawingContext.lineWidth = 0.7;
        drawingContext.globalAlpha = (0.32 + 0.5 * weight) * growth;
        drawingContext.beginPath();
        drawingContext.arc(point.x, point.y, 6 + 3 * weight, 0, FULL_TURN_RADIANS);
        drawingContext.stroke();
        drawingContext.globalAlpha = 1;
      }
    }
    for (let starIndex = 0; starIndex < layout.stars.length; starIndex++) {
      const star = layout.stars[starIndex];
      drawNode(
        drawingContext,
        state.palette,
        state.glow,
        star.x,
        star.y,
        star.vega ? 3 : 2.5,
        stagger(state.progress, 0.32 + starIndex * 0.05, 0.16),
        true,
        0.95,
        star.vega,
      );
    }
  }

  function drawSignals(drawingContext: CanvasRenderingContext2D, state: FrameState, layout: FieldLayout) {
    const progress = state.progress;
    const vega = layout.stars[0];
    let bloom = REST_BLOOM;
    let arrivalProgress = 0;
    if (!state.reduced) {
      let pulse = 0;
      if (progress < 1) {
        for (let cometIndex = 0; cometIndex < entranceArticleIndices.length; cometIndex++) {
          const travel = stagger(progress, 0.36 + cometIndex * 0.1, 0.36);
          drawComet(
            drawingContext,
            state.palette,
            state.glow,
            routes[entranceArticleIndices[cometIndex]],
            travel,
            70,
          );
          if (travel > 0.86 && travel < 1) {
            arrivalProgress = Math.max(arrivalProgress, (travel - 0.86) / 0.14);
          }
        }
        pulse = smooth((progress - 0.6) / 0.25) * (1 - smooth((progress - 0.88) / 0.12)) * 0.9;
      } else if (activeArticleIndex >= 0) {
        const phase = (state.activeTime - selectionStartTime) % CYCLE;
        const travel = phase < RUN ? phase / RUN : 0;
        drawComet(
          drawingContext,
          state.palette,
          state.glow,
          routes[activeArticleIndex],
          travel,
          70,
        );
        if (travel > 0.8) {
          arrivalProgress = (travel - 0.8) / 0.2;
          pulse = smooth((travel - 0.8) / 0.12) * (1 - smooth((travel - 0.95) / 0.05));
        }
      }
      bloom = Math.max(pulse, REST_BLOOM * smooth((progress - 0.85) / 0.15));
    }
    drawVegaBloom(drawingContext, state.glow, vega.x, vega.y, bloom);
    if (arrivalProgress > 0) {
      drawingContext.strokeStyle = state.palette.sky;
      drawingContext.lineWidth = 0.7;
      drawingContext.globalAlpha = 0.5 * (1 - arrivalProgress);
      drawingContext.beginPath();
      drawingContext.arc(vega.x, vega.y, 10 + 22 * arrivalProgress, 0, FULL_TURN_RADIANS);
      drawingContext.stroke();
      drawingContext.globalAlpha = 1;
    }
  }

  function drawLabels(drawingContext: CanvasRenderingContext2D, state: FrameState, layout: FieldLayout) {
    const articleLabelProgress = smooth((state.progress - 0.2) / 0.2);
    const starLabelProgress = smooth((state.progress - 0.72) / 0.2);
    for (let articleIndex = 0; articleIndex < articleCount; articleIndex++) {
      const label = layout.articleLabels[articleIndex];
      drawLabel(
        drawingContext,
        state.palette,
        state.labelFont.canvasFont,
        label.text,
        label.x,
        label.y,
        label.align,
        articleLabelProgress,
      );
      const weight = weights[articleIndex];
      if (weight > 0.02) {
        drawingContext.globalAlpha = weight * articleLabelProgress;
        drawingContext.fillStyle = state.palette.text;
        drawingContext.fillText(label.text, label.x, label.y);
        drawingContext.globalAlpha = 1;
      }
    }
    for (let starIndex = 0; starIndex < layout.starLabels.length; starIndex++) {
      const label = layout.starLabels[starIndex];
      if (label) {
        drawLabel(
          drawingContext,
          state.palette,
          state.labelFont.canvasFont,
          label.text,
          label.x,
          label.y,
          label.align,
          starLabelProgress,
        );
      }
    }
  }

  function draw(drawingContext: CanvasRenderingContext2D, state: FrameState) {
    if (!field) return;
    const maximumWeight = easeWeights(
      Math.max(0, Math.min(64, state.activeTime - previousActiveTime)),
      state.reduced,
    );
    previousActiveTime = state.activeTime;
    const backgroundStrength = 1 - 0.6 * maximumWeight;
    drawingContext.save();
    drawingContext.translate(originX, 0);

    drawBackground(drawingContext, state, field, backgroundStrength);
    drawLinks(drawingContext, state, field, backgroundStrength);
    drawSelectionPaths(drawingContext, state);
    drawStars(drawingContext, state, field);
    drawSignals(drawingContext, state, field);
    drawLabels(drawingContext, state, field);
    drawingContext.restore();

    // Ask for frames only while an article is lit or its glow still fades.
    return !state.reduced && (activeArticleIndex >= 0 || maximumWeight >= 0.01);
  }

  // Pointer and focus on an article light it. The container attribute changes once for each change of article.
  function attach(canvasHandle: CanvasHandle) {
    const events = new AbortController();
    const options = { signal: events.signal };

    function select(index: number) {
      if (index === activeArticleIndex) return;
      activeArticleIndex = index;
      selectionStartTime = canvasHandle.state.activeTime;
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
      activeArticleIndex = -1;
      weights.fill(0);
      delete container.dataset.activeArticle;
    };
  }

  return mountCanvas(container, { draw, onResize: build, attach });
}
