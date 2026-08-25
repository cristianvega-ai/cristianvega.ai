export const MAX_PIXEL_RATIO = 2;
/** Sky stays sharp, but a full-grid 2x buffer is too large on big screens. */
export const MAX_SKY_BACKING_PIXELS = 2_073_600;
/** Copy particles do not need a retina full-grid buffer. */
export const MAX_COPY_BACKING_PIXELS = 655_360;

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

export type MeasureOptions = {
  /** Allocate copy backing. Default is off: the copy layer is unused after the entrance. */
  copyBacking?: boolean;
};

/**
 * Backing scale from CSS size, device ratio, and a pixel budget.
 * The area cap can drop the scale below 1 on a large canvas.
 */
export function backingScale(
  cssWidth: number,
  cssHeight: number,
  maxPixels: number,
  devicePixelRatio: number,
): number {
  const dpr = Math.min(devicePixelRatio > 0 ? devicePixelRatio : 1, MAX_PIXEL_RATIO);
  const area = cssWidth * cssHeight;
  if (!(area > 0) || !(maxPixels > 0)) return 1;
  return Math.min(dpr, Math.sqrt(maxPixels / area));
}

function sizeLayer(
  canvas: HTMLCanvasElement,
  hostRect: DOMRect,
  gridRect: DOMRect,
  options: { maxPixels: number; backing: boolean },
): CanvasLayer | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  if (!hostRect.width || !hostRect.height) return null;

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

  if (!options.backing) {
    canvas.width = 0;
    canvas.height = 0;
    return { canvas, ctx, rect, dpr: 1 };
  }

  const dpr = backingScale(
    rect.width,
    rect.height,
    options.maxPixels,
    window.devicePixelRatio || 1,
  );
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);

  return { canvas, ctx, rect, dpr };
}

export function measureLayout(
  root: HTMLElement,
  options: MeasureOptions = {},
): Layout | null {
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
  const sky = sizeLayer(skyCanvas, gridRect, gridRect, {
    maxPixels: MAX_SKY_BACKING_PIXELS,
    backing: true,
  });
  const copy = sizeLayer(copyCanvas, gridRect, gridRect, {
    maxPixels: MAX_COPY_BACKING_PIXELS,
    backing: options.copyBacking === true,
  });
  if (!sky || !copy) return null;

  const chart: Rect = {
    left: chartHost.left - gridRect.left,
    top: chartHost.top - gridRect.top,
    width: chartHost.width,
    height: chartHost.height,
  };

  return { sky, copy, chart };
}
