import {
  mountCanvasController,
  PAGE_GRAPHIC_POLICY,
  type CanvasHandle as ControllerHandle,
  type FrameState as ControllerState,
  type MountOptions as ControllerOptions,
} from "../motion/canvas-controller.ts";
import { makeLabelFont, type LabelFont } from "./label-font.ts";

export interface FrameState extends ControllerState {
  labelFont: LabelFont;
}

export interface CanvasHandle extends ControllerHandle {
  state: FrameState;
}

export interface MountOptions extends Omit<ControllerOptions, "draw" | "onResize" | "attach"> {
  draw: (drawingContext: CanvasRenderingContext2D, state: FrameState) => boolean | void;
  /** Build the scene when its canvas box or loaded fonts change. */
  onResize?: (state: FrameState) => void;
  attach?: (handle: CanvasHandle) => (() => void) | void;
}

/** Mount a page scene. Preserve its entrance across restores. */
export function mountCanvas(container: HTMLElement, options: MountOptions): CanvasHandle | null {
  const drawingContext = container.querySelector("canvas")?.getContext("2d");
  if (!drawingContext) return null;

  function prepareFont(state: ControllerState): FrameState {
    const pageState = state as FrameState;
    const style = getComputedStyle(container);
    pageState.labelFont = makeLabelFont(drawingContext!, style.getPropertyValue("--font-monospace"), style.getPropertyValue("--font-size-graphic-label"));
    return pageState;
  }

  const handle = mountCanvasController(container, {
    ...options,
    draw: (context, state) => options.draw(context, state as FrameState),
    onResize: (state) => options.onResize?.(prepareFont(state)),
    attach(controller) {
      const current = { active: true };
      prepareFont(controller.state);
      const detach = options.attach?.(controller as CanvasHandle);
      const fonts = container.ownerDocument.fonts;
      // The controller skips a scene without a size, and it applies a pending motion preference before it draws.
      function refresh() {
        if (current.active) controller.rebuild();
      }
      fonts?.addEventListener("loadingdone", refresh);
      fonts?.addEventListener("loadingerror", refresh);
      void fonts?.ready.then(refresh);
      return () => {
        current.active = false;
        fonts?.removeEventListener("loadingdone", refresh);
        fonts?.removeEventListener("loadingerror", refresh);
        detach?.();
      };
    },
  }, PAGE_GRAPHIC_POLICY, () => {
    container.hidden = true;
  });
  return handle as CanvasHandle | null;
}
