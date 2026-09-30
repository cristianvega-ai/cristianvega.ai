import { DURATION, entranceProgress } from "./clock.ts";
import { getGlow, readPalette, type Palette } from "./palette.ts";

/** The one state object that every draw call receives. It is reused, so a frame allocates nothing. */
export interface FrameState {
  /** The canvas size in CSS pixels. */
  w: number;
  h: number;
  /** Device pixels per CSS pixel, capped by `dprCap`. */
  ratio: number;
  /** Milliseconds of entrance played, from 0 to the duration. */
  elapsed: number;
  /** The eased entrance clock, from 0 to 1. At 1 the picture is finished. */
  progress: number;
  /** Milliseconds since mount or replay. Use it for ambient drift. */
  t: number;
  /** True when the entrance is finished. */
  still: boolean;
  /** True when the visitor asks for reduced motion: draw the final picture with no drift. */
  reduced: boolean;
  palette: Palette;
  glow: HTMLCanvasElement;
}

export interface MountOptions {
  /**
   * Draw one frame. The context is cleared and scaled to CSS pixels.
   * Return true to ask for another frame after the entrance, for a drift or a scroll that is still settling.
   * Return nothing when the picture is at rest, and the loop stops.
   */
  draw: (ctx: CanvasRenderingContext2D, state: FrameState) => boolean | void;
  /** Rebuild the layout here. It runs when the canvas box changes, never per frame. */
  onResize?: (state: FrameState) => void;
  /**
   * Connect page listeners, such as scroll. It runs on setup and again after a restored page.
   * Call `wake` from a listener to draw a frame when the loop is at rest.
   * Return the function that removes the listeners.
   */
  attach?: (handle: CanvasHandle) => (() => void) | void;
  /** The entrance length in milliseconds. */
  duration?: number;
  /** The most device pixels per CSS pixel. */
  dprCap?: number;
}

export interface CanvasHandle {
  state: FrameState;
  /** Play the entrance again. */
  replay: () => void;
  /** Draw one frame now. */
  redraw: () => void;
  /** Ask for a frame when the loop is at rest. A frame runs only while the box shows. */
  wake: () => void;
  /** Stop for good. A hidden or restored page never brings it back. */
  destroy: () => void;
}

/**
 * Run a page graphic on the canvas inside `container`.
 *
 * The container gets `data-ready="true"` after the first frame, and `data-motion-state`
 * of "playing" while frames run or "still" when the picture is at rest.
 * The loop pauses off-screen and while the tab is hidden. Reduced motion draws the
 * finished picture at once and runs no frames. A live change of the preference applies.
 * Teardown runs on pagehide, and a restored page (a persisted pageshow) sets up again.
 * Returns null when the browser cannot draw the canvas.
 */
export function mountCanvas(container: HTMLElement, options: MountOptions): CanvasHandle | null {
  const { draw, onResize, attach, duration = DURATION, dprCap = 2 } = options;
  const canvas = container.querySelector("canvas");
  const ctx = canvas?.getContext("2d");
  const palette = readPalette();
  const glow = getGlow(palette);
  if (!canvas || !ctx || !glow || !("ResizeObserver" in window) || !("IntersectionObserver" in window)) return null;

  const reducedQuery = matchMedia("(prefers-reduced-motion: reduce)");
  const state: FrameState = {
    w: 0,
    h: 0,
    ratio: 1,
    elapsed: reducedQuery.matches ? duration : 0,
    progress: 0,
    t: 0,
    still: false,
    reduced: reducedQuery.matches,
    palette,
    glow,
  };
  let frame = 0;
  let previous = 0;
  let visible = false;
  let active = false;
  let destroyed = false;
  let sized = false;
  let busy = false;
  let motion = "";
  let observers: { size: ResizeObserver; intersection: IntersectionObserver } | undefined;
  let detach: (() => void) | void;

  function paint() {
    if (!sized) return;
    state.reduced = reducedQuery.matches;
    if (state.reduced) {
      state.elapsed = duration;
      state.t = 0;
    }
    state.progress = entranceProgress(state.elapsed * (DURATION / duration));
    state.still = state.elapsed >= duration;
    ctx!.setTransform(1, 0, 0, 1, 0, 0);
    ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
    ctx!.setTransform(state.ratio, 0, 0, state.ratio, 0, 0);
    ctx!.globalAlpha = 1;
    busy = draw(ctx!, state) === true;
    ctx!.globalAlpha = 1;
    // Write the attribute only when it changes, so a frame leaves the DOM alone.
    const next = state.still && !(busy && !state.reduced) ? "still" : "playing";
    if (next !== motion) {
      motion = next;
      container.dataset.motionState = next;
    }
  }

  function running() {
    return active && visible && !document.hidden && !state.reduced && (busy || state.elapsed < duration);
  }

  function tick(time: number) {
    frame = 0;
    if (previous) {
      const dt = Math.min(64, time - previous);
      state.elapsed = Math.min(duration, state.elapsed + dt);
      state.t += dt;
    }
    previous = time;
    paint();
    resume();
    // At rest, the next frame must not count the idle time.
    if (!frame) previous = 0;
  }

  function resume() {
    if (!frame && running()) frame = requestAnimationFrame(tick);
  }

  function pause() {
    cancelAnimationFrame(frame);
    frame = 0;
    previous = 0;
  }

  function wake() {
    busy = true;
    resume();
  }

  function resize(w: number, h: number) {
    if (!active || !w || !h) return;
    state.ratio = Math.min(devicePixelRatio || 1, dprCap);
    state.w = w;
    state.h = h;
    canvas!.width = Math.round(w * state.ratio);
    canvas!.height = Math.round(h * state.ratio);
    sized = true;
    onResize?.(state);
    paint();
    container.dataset.ready = "true";
    resume();
  }

  const onVisibility = () => (document.hidden ? pause() : resume());
  const onPreference = () => {
    pause();
    if (reducedQuery.matches) state.elapsed = duration;
    paint();
    resume();
  };

  function setup() {
    if (active || destroyed) return;
    active = true;
    sized = false;
    const size = new ResizeObserver((entries) => {
      const box = entries[entries.length - 1].contentRect;
      resize(box.width, box.height);
    });
    const intersection = new IntersectionObserver((entries) => {
      visible = entries[entries.length - 1].isIntersecting;
      if (visible) resume();
      else pause();
    });
    observers = { size, intersection };
    size.observe(canvas!);
    intersection.observe(container);
    document.addEventListener("visibilitychange", onVisibility);
    reducedQuery.addEventListener("change", onPreference);
    detach = attach?.(handle);
  }

  function teardown() {
    if (!active) return;
    active = false;
    pause();
    observers?.size.disconnect();
    observers?.intersection.disconnect();
    observers = undefined;
    document.removeEventListener("visibilitychange", onVisibility);
    reducedQuery.removeEventListener("change", onPreference);
    detach?.();
    detach = undefined;
    container.removeAttribute("data-ready");
    container.removeAttribute("data-motion-state");
    motion = "";
  }

  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) setup();
  };

  function destroy() {
    destroyed = true;
    teardown();
    window.removeEventListener("pagehide", teardown);
    window.removeEventListener("pageshow", onPageShow);
  }

  const handle: CanvasHandle = {
    state,
    destroy,
    wake,
    redraw: paint,
    replay() {
      pause();
      state.elapsed = 0;
      state.t = 0;
      paint();
      resume();
    },
  };
  window.addEventListener("pagehide", teardown);
  window.addEventListener("pageshow", onPageShow);
  setup();
  return handle;
}
