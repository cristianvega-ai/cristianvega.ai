import { DURATION, entranceProgress } from "./clock.ts";
import { getGlow, readPalette, type Palette } from "./palette.ts";

/** The controller reuses this state for every draw. */
export interface FrameState {
  /** Canvas width and height use CSS pixels. */
  width: number;
  height: number;
  /** Device pixels per CSS pixel, capped by the scene policy. */
  ratio: number;
  /** Played entrance time, in milliseconds. */
  elapsed: number;
  /** Eased entrance progress, from 0 to 1. */
  progress: number;
  /** Active time since mount or replay, in milliseconds. */
  activeTime: number;
  /** True when the entrance finishes. */
  entranceComplete: boolean;
  /** True when the visitor requests reduced motion. */
  reduced: boolean;
  palette: Palette;
  glow: HTMLCanvasElement;
}

export interface MountOptions {
  /** Draw in CSS pixels. Return true while motion continues after the entrance. */
  draw: (ctx: CanvasRenderingContext2D, state: FrameState) => boolean | void;
  /** Build the scene when the canvas box changes. */
  onResize?: (state: FrameState) => void;
  /** Connect scene listeners. Return their cleanup function. Call wake when an idle scene changes. */
  attach?: (handle: CanvasHandle) => (() => void) | void;
  /** Entrance duration, in milliseconds. */
  duration?: number;
  /** Maximum device pixels per CSS pixel. */
  dprCap?: number;
}

export interface CanvasHandle {
  state: FrameState;
  /** Restart the entrance. */
  replay: () => void;
  /** Draw the current state. */
  redraw: () => void;
  /**
   * Run onResize for the current box, then draw. A preference change that the controller has not
   * handled yet applies first, so a caller such as a font refresh does not depend on event order.
   * It does nothing before the first size or after teardown.
   */
  rebuild: () => void;
  /** Request a frame when the scene is idle and visible. */
  wake: () => void;
  /** Stop the controller permanently. */
  destroy: () => void;
}

/**
 * Every canvas advances its clocks by at most this many milliseconds in one frame. A long frame,
 * such as a main-thread stall while the page loads, then slows the motion for a moment instead of
 * skipping part of it. The globe and the page scenes share it, so their clocks stay coordinated.
 */
export const FRAME_INTERVAL_CAP_MS = 64;

interface CanvasPolicy {
  dprCap: number;
  restartOnRestore: boolean;
}

export const PAGE_GRAPHIC_POLICY: CanvasPolicy = {
  dprCap: 2,
  restartOnRestore: false,
};

export const GLOBE_POLICY: CanvasPolicy = {
  dprCap: 1.75,
  restartOnRestore: true,
};

/** Own canvas clocks, observers, frames, listeners, and page restoration. Keep scene drawing and fallback outside this controller. */
export function mountCanvasController(
  container: HTMLElement,
  options: MountOptions,
  policy: CanvasPolicy,
  onFailure?: () => void,
): CanvasHandle | null {
  const { draw, onResize, attach, duration = DURATION, dprCap = policy.dprCap } = options;
  const canvas = container.querySelector("canvas");
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx || !("ResizeObserver" in window) || !("IntersectionObserver" in window)) return null;
  const palette = readPalette(container);
  const glow = palette && getGlow(palette);
  if (!palette || !glow) return null;

  const reducedQuery = matchMedia("(prefers-reduced-motion: reduce)");
  const state: FrameState = {
    width: 0,
    height: 0,
    ratio: 1,
    elapsed: reducedQuery.matches ? duration : 0,
    progress: 0,
    activeTime: 0,
    entranceComplete: false,
    reduced: reducedQuery.matches,
    palette,
    glow,
  };
  let frame = 0;
  let previous: number | undefined;
  let visible = false;
  let active = false;
  let destroyed = false;
  let sized = false;
  let busy = false;
  let motion = "";
  let size: ResizeObserver | undefined;
  let intersection: IntersectionObserver | undefined;
  let detach: (() => void) | void;

  function paint() {
    if (!active || !sized) return;
    state.reduced = reducedQuery.matches;
    if (state.reduced) {
      state.elapsed = duration;
      state.activeTime = 0;
    }
    state.progress = entranceProgress(state.elapsed * (DURATION / duration));
    state.entranceComplete = state.elapsed >= duration;
    try {
      ctx!.setTransform(1, 0, 0, 1, 0, 0);
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      ctx!.setTransform(state.ratio, 0, 0, state.ratio, 0, 0);
      ctx!.globalAlpha = 1;
      busy = draw(ctx!, state) === true;
      ctx!.globalAlpha = 1;
      // Write the motion state only when it changes.
      const next = state.entranceComplete && !(busy && !state.reduced) ? "still" : "playing";
      if (next !== motion) {
        motion = next;
        container.dataset.motionState = next;
      }
    } catch {
      fail();
    }
  }

  function running() {
    return active && sized && visible && !document.hidden && !state.reduced && (busy || state.elapsed < duration);
  }

  function tick(time: number) {
    frame = 0;
    if (!running()) {
      previous = undefined;
      return;
    }
    if (previous !== undefined) {
      const dt = Math.min(FRAME_INTERVAL_CAP_MS, time - previous);
      state.elapsed = Math.min(duration, state.elapsed + dt);
      state.activeTime += dt;
    }
    previous = time;
    paint();
    resume();
    // Exclude idle time from the next frame.
    if (!frame) previous = undefined;
  }

  function resume() {
    if (!frame && running()) frame = requestAnimationFrame(tick);
  }

  function pause() {
    cancelAnimationFrame(frame);
    frame = 0;
    previous = undefined;
  }

  function wake() {
    if (!active) return;
    busy = true;
    resume();
  }

  function resize(w: number, h: number) {
    if (!active || !w || !h) return;
    state.ratio = Math.min(devicePixelRatio || 1, dprCap);
    state.width = w;
    state.height = h;
    canvas!.width = Math.round(w * state.ratio);
    canvas!.height = Math.round(h * state.ratio);
    sized = true;
    try {
      onResize?.(state);
      paint();
      if (!active) return;
      container.dataset.ready = "true";
      resume();
    } catch {
      fail();
    }
  }

  const onVisibility = () => (document.hidden ? pause() : resume());
  const onPreference = () => {
    pause();
    state.reduced = reducedQuery.matches;
    paint();
    resume();
  };

  function rebuild() {
    if (!active || !sized) return;
    try {
      onResize?.(state);
    } catch {
      fail();
      return;
    }
    if (state.reduced !== reducedQuery.matches) {
      onPreference();
      return;
    }
    paint();
    resume();
  }

  function setup(restored = false): boolean {
    if (active) return true;
    if (destroyed) return false;
    active = true;
    sized = false;
    visible = false;
    busy = false;
    state.reduced = reducedQuery.matches;
    if (restored && policy.restartOnRestore) {
      state.elapsed = state.reduced ? duration : 0;
      state.activeTime = 0;
    }
    try {
      const currentSize = new ResizeObserver((entries) => {
        if (size !== currentSize) return;
        const box = entries[entries.length - 1].contentRect;
        resize(box.width, box.height);
      });
      size = currentSize;
      const currentIntersection = new IntersectionObserver((entries) => {
        if (!active || intersection !== currentIntersection) return;
        visible = entries[entries.length - 1].isIntersecting;
        if (visible) resume();
        else pause();
      });
      intersection = currentIntersection;
      size.observe(canvas!);
      intersection.observe(container);
      document.addEventListener("visibilitychange", onVisibility);
      reducedQuery.addEventListener("change", onPreference);
      detach = attach?.(handle);
      return true;
    } catch {
      teardown();
      return false;
    }
  }

  function teardown() {
    if (!active) return;
    active = false;
    pause();
    size?.disconnect();
    intersection?.disconnect();
    size = undefined;
    intersection = undefined;
    document.removeEventListener("visibilitychange", onVisibility);
    reducedQuery.removeEventListener("change", onPreference);
    detach?.();
    detach = undefined;
    sized = false;
    visible = false;
    container.removeAttribute("data-ready");
    container.removeAttribute("data-motion-state");
    motion = "";
  }

  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted && !setup(true) && !destroyed) fail();
  };

  function destroy() {
    destroyed = true;
    teardown();
    window.removeEventListener("pagehide", teardown);
    window.removeEventListener("pageshow", onPageShow);
  }

  function fail() {
    if (destroyed) return;
    destroy();
    onFailure?.();
  }

  const handle: CanvasHandle = {
    state,
    destroy,
    wake,
    redraw: paint,
    rebuild,
    replay() {
      if (!active) return;
      pause();
      state.elapsed = 0;
      state.activeTime = 0;
      paint();
      resume();
    },
  };
  if (!setup()) {
    destroy();
    return null;
  }
  window.addEventListener("pagehide", teardown);
  window.addEventListener("pageshow", onPageShow);
  return handle;
}
