export const MAX_PIXEL_RATIO = 2;

export type Rect = { left: number; top: number; width: number; height: number };

export type CanvasLayer = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  rect: Rect;
  dpr: number;
};

export type Layout = {
  portrait: CanvasLayer;
  copy: CanvasLayer;
};

export function sizeLayer(
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
  // Chart stays visible; copy canvas display is managed by reveal/animation paths
  if (canvas.classList.contains("hero__portrait-canvas")) {
    canvas.style.display = "block";
  }

  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);

  return { canvas, ctx, rect, dpr };
}

export function measureLayout(root: HTMLElement): Layout | null {
  const grid = root.querySelector<HTMLElement>(".hero__grid");
  const portraitCol = root.querySelector<HTMLElement>(".hero__portrait-col");
  const main = root.querySelector<HTMLElement>(".hero__main");
  const portraitCanvas = root.querySelector<HTMLCanvasElement>(".hero__portrait-canvas");
  const copyCanvas = root.querySelector<HTMLCanvasElement>(".hero__copy-canvas");

  if (!grid || !portraitCol || !main || !portraitCanvas || !copyCanvas) return null;

  const gridRect = grid.getBoundingClientRect();
  const portraitHost = portraitCol.getBoundingClientRect();
  const mainHost = main.getBoundingClientRect();

  if (!gridRect.width || !gridRect.height) return null;
  if (!portraitHost.width || !portraitHost.height) return null;
  if (!mainHost.width || !mainHost.height) return null;

  const portrait = sizeLayer(portraitCanvas, portraitHost, gridRect);
  // Full-grid copy canvas so transfer particles are visible from chart sources
  // across the seam (not clipped to the left column alone).
  const copy = sizeLayer(copyCanvas, gridRect, gridRect);
  if (!portrait || !copy) return null;

  return { portrait, copy };
}
