import { clamp } from "./math.ts";
import type { CanvasHandle, FrameState } from "./mount.ts";

/**
 * The reader's place on the page, for a graphic that follows the scroll.
 * It reads `scrollY` once per frame, in `value`. It caches the page height and
 * measures it again only when the layout resizes. The share is `scrollY / max(1, scrollHeight - innerHeight)`,
 * and a page that cannot scroll reads 1.
 */
export interface ScrollReader {
  /** True when the graphic is fixed in the viewport, so the scroll can drive it. Read on resize. */
  readonly linked: boolean;
  /** True when the smoothed value has reached the scroll. The draw can stop asking for frames. */
  readonly settled: boolean;
  /** Measure the page height and the placement. Call it from `onResize`. */
  measure: () => void;
  /**
   * The scroll share 0..1, smoothed. Reduced motion gets the raw share, with no easing.
   * When the graphic is not linked, it reads 1.
   */
  value: (state: FrameState) => number;
  /** Connect the listeners. Pass it as the `attach` option. Returns the removal. */
  attach: (handle: CanvasHandle) => () => void;
}

const SETTLE_DISTANCE = 0.0005;

/** Draw a change. Reduced motion runs no frames, so the change draws at once. Otherwise a frame settles it. */
function refresh(handle: CanvasHandle) {
  if (handle.state.reduced) handle.redraw();
  else handle.wake();
}

export function createScrollReader(container: HTMLElement): ScrollReader {
  let max = 1;
  let scrolls = false;
  let linked = false;
  let settled = true;
  let value = 0;
  let last = 0;
  let primed = false;

  function measure() {
    const room = document.documentElement.scrollHeight - innerHeight;
    max = Math.max(1, room);
    scrolls = room > 1;
    // The stylesheet decides where the graphic sits. Fixed means it stays in view beside the column.
    linked = getComputedStyle(container).position === "fixed";
  }

  return {
    get linked() {
      return linked;
    },
    get settled() {
      return settled;
    },
    measure,
    value(state) {
      if (!linked) {
        settled = true;
        return 1;
      }
      const dt = clamp(state.activeTime - last, 0, 64);
      last = state.activeTime;
      // A page that cannot scroll rests at the end, so its graphic shows the whole journey.
      const target = scrolls ? clamp(scrollY / max) : 1;
      // Reduced motion jumps to the reader's place. So does the first read, so a restored scroll does not glide.
      if (!primed || state.reduced) {
        primed = true;
        value = target;
      }
      value += (target - value) * (1 - Math.exp(-dt / 160));
      settled = Math.abs(target - value) < SETTLE_DISTANCE;
      if (settled) value = target;
      return value;
    },
    attach(handle) {
      // The page height changes when fonts load or the text wraps, and no scroll event follows.
      const observer = new ResizeObserver(() => {
        measure();
        refresh(handle);
      });
      observer.observe(document.body);
      const onScroll = () => {
        if (linked) refresh(handle);
      };
      addEventListener("scroll", onScroll, { passive: true });
      return () => {
        observer.disconnect();
        removeEventListener("scroll", onScroll);
      };
    },
  };
}
