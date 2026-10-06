import { mountCanvasController, PAGE_GRAPHIC_POLICY, type CanvasHandle, type MountOptions } from "../motion/canvas-controller.ts";

export type { CanvasHandle, FrameState, MountOptions } from "../motion/canvas-controller.ts";

/** Mount a page scene. Preserve its entrance across restores and cap each frame interval at 64 milliseconds. */
export function mountCanvas(container: HTMLElement, options: MountOptions): CanvasHandle | null {
  return mountCanvasController(container, options, PAGE_GRAPHIC_POLICY, () => {
    container.hidden = true;
  });
}
