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
  draw: (ctx: CanvasRenderingContext2D, state: FrameState) => boolean | void;
  /** Build the scene when its canvas box or loaded fonts change. */
  onResize?: (state: FrameState) => void;
  attach?: (handle: CanvasHandle) => (() => void) | void;
}

/** Mount a page scene. Preserve its entrance across restores. */
export function mountCanvas(container: HTMLElement, options: MountOptions): CanvasHandle | null {
  const ctx = container.querySelector("canvas")?.getContext("2d");
  if (!ctx) return null;
  const reducedQuery = matchMedia("(prefers-reduced-motion: reduce)");
  let lifetime: { active: boolean; sized: boolean } | undefined;
  let moving = false;

  function prepareFont(state: ControllerState): FrameState {
    const pageState = state as FrameState;
    const family = getComputedStyle(container).getPropertyValue("--font-mono");
    pageState.labelFont = makeLabelFont(ctx!, family);
    return pageState;
  }

  function build(state: ControllerState) {
    const pageState = prepareFont(state);
    options.onResize?.(pageState);
    if (lifetime) lifetime.sized = true;
  }

  const handle = mountCanvasController(container, {
    ...options,
    draw(context, state) {
      const result = options.draw(context, state as FrameState);
      moving = result === true;
      return result;
    },
    onResize: build,
    attach(controller) {
      const current = { active: true, sized: false };
      lifetime = current;
      const pageHandle = controller as CanvasHandle;
      prepareFont(controller.state);
      const detach = options.attach?.(pageHandle);
      const fonts = container.ownerDocument.fonts;
      function refresh() {
        if (!current.active || lifetime !== current || !current.sized) return;
        try {
          build(controller.state);
          // Let the controller apply a pending motion preference before the font redraw.
          if (controller.state.reduced === reducedQuery.matches) {
            controller.redraw();
            if (current.active && moving && !controller.state.reduced) controller.wake();
          }
        } catch {
          controller.destroy();
          container.hidden = true;
        }
      }
      fonts?.addEventListener("loadingdone", refresh);
      fonts?.addEventListener("loadingerror", refresh);
      void fonts?.ready.then(refresh);
      return () => {
        current.active = false;
        current.sized = false;
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
