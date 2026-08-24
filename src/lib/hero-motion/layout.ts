const MAX_PIXEL_RATIO = 2;

export type Rect = { left: number; top: number; width: number; height: number };

export type CanvasLayer = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  rect: Rect;
  dpr: number;
};

export type Layout = {
  sky: CanvasLayer;
  copy: CanvasLayer;
  /** Grid-local box the Lyra figure is anchored to. Stars fill the whole sky. */
  chart: Rect;
};

function sizeLayer(
  canvas: HTMLCanvasElement,
  hostRect: DOMRect,
  gridRect: DOMRect,
): CanvasLayer | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  if (!hostRect.width || !hostRect.height) return null;

  const dpr = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
  const rect: Rect = {
    left: hostRect.left - gridRect.left,
    top: hostRect.top - gridRect.top,
    width: hostRect.width,
    height: hostRect.height,
  };

  canvas.style.left = `${rect.left}px`;
  canvas.style.top = `${rect.top}px`;
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  // Sky stays visible; copy canvas display is managed by reveal/animation paths
  if (canvas.classList.contains("hero__sky-canvas")) {
    canvas.style.display = "block";
  }

  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);

  return { canvas, ctx, rect, dpr };
}

export function measureLayout(root: HTMLElement): Layout | null {
  const grid = root.querySelector<HTMLElement>(".hero__grid");
  const chartCol = root.querySelector<HTMLElement>(".hero__chart-col");
  const main = root.querySelector<HTMLElement>(".hero__main");
  const skyCanvas = root.querySelector<HTMLCanvasElement>(".hero__sky-canvas");
  const copyCanvas = root.querySelector<HTMLCanvasElement>(".hero__copy-canvas");

  if (!grid || !chartCol || !main || !skyCanvas || !copyCanvas) return null;

  const gridRect = grid.getBoundingClientRect();
  const chartHost = chartCol.getBoundingClientRect();
  const mainHost = main.getBoundingClientRect();

  if (!gridRect.width || !gridRect.height) return null;
  if (!chartHost.width || !chartHost.height) return null;
  if (!mainHost.width || !mainHost.height) return null;

  // Both layers span the full grid: the star field covers the whole masthead,
  // and transfer particles travel anywhere across it without clipping.
  const sky = sizeLayer(skyCanvas, gridRect, gridRect);
  const copy = sizeLayer(copyCanvas, gridRect, gridRect);
  if (!sky || !copy) return null;

  const chart: Rect = {
    left: chartHost.left - gridRect.left,
    top: chartHost.top - gridRect.top,
    width: chartHost.width,
    height: chartHost.height,
  };

  return { sky, copy, chart };
}
