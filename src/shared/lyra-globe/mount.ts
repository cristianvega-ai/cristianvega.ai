import { GLOBE_POLICY, mountCanvasController, type FrameState } from "../canvas/canvas-controller.ts";
import { createLabelAnimations } from "./label-animations.ts";
import { buildGlobe, GLOBE_WIDTH, type Globe } from "./model.ts";
import { paintGlobeFrame } from "./paint.ts";

/** Put the build-time SVG in the box. It is the picture when the canvas cannot draw. */
function showFallback(root: HTMLElement): void {
  const fallbackDrawing = root.querySelector("template")?.content.firstElementChild?.cloneNode(true) as Element | undefined;
  if (!fallbackDrawing) return;
  root.prepend(fallbackDrawing);
  root.dataset.fallback = "true";
}

/**
 * Draw the Lyra globe on its canvas, with a short entrance. The build-time SVG
 * is not on the page while the canvas works. It sits in a noscript for visitors
 * without JavaScript, and this function puts a copy in the box when canvas is
 * missing or setup fails.
 */
export function mountLyraGlobe(): void {
  const root = document.querySelector<HTMLElement>("[data-lyra-globe]");
  if (!root) return;
  try {
    if (!mountGlobeCanvas(root)) showFallback(root);
  } catch {
    showFallback(root);
  }
}

/** Draw the globe scene. Restart its entrance after a restored page. Return false when the canvas cannot draw. */
function mountGlobeCanvas(root: HTMLElement): boolean {
  let globe: Globe | undefined;
  let vega: Globe["hotNodes"][number] | undefined;
  let scale = 1;
  const labels = createLabelAnimations(root.querySelectorAll<SVGTextElement>(".lyra-globe__label"));

  function resize(state: FrameState) {
    // Keep the canvas projection equal to the SVG projection.
    scale = Math.round(state.width * state.ratio) / GLOBE_WIDTH;
    globe = globe ?? buildGlobe();
    vega = globe.hotNodes.find((node) => node.vega);
  }

  function draw(drawingContext: CanvasRenderingContext2D, state: FrameState) {
    if (!globe) return;
    labels.update(state.progress, state.entranceComplete);
    paintGlobeFrame(drawingContext, globe, vega, scale, state);
  }

  const handle = mountCanvasController(root, { draw, onResize: resize, attach: labels.attach }, GLOBE_POLICY, () => showFallback(root));
  return handle !== null;
}
