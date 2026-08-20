import { clamp, smoothstep } from "./easing";
import { measureLayout, type Layout } from "./layout";
import {
  collectTargetBindings,
  drawFrame,
  hideMotionTargets,
  isActionTarget,
  prepareMotion,
  type MotionPrep,
} from "./particles";
import {
  AMBIENT_FRAME_INTERVAL_MS,
  drawStaticScene,
  SATELLITE_DURATION,
  SATELLITE_FIRST_PASS,
  SATELLITE_PERIOD,
  sceneFor,
} from "./star-chart";
import {
  FAILSAFE_DURATION,
  FONT_DEADLINE_MS,
  FULL_DURATION,
  markPlayedThisSession,
  plannedDuration,
  QUICK_DURATION,
  type TargetBinding,
} from "./timeline";

let dispose: (() => void) | null = null;
/** Bumped on every setup() entry so stale async runs abort after await. */
let setupGen = 0;

function clearHeroMotionPending() {
  document.documentElement.removeAttribute("data-hero-motion-pending");
}

function clearTargetStyles(root: HTMLElement) {
  clearHeroMotionPending();
  root.querySelectorAll<HTMLElement>("[data-motion-target]").forEach((element) => {
    element.style.removeProperty("opacity");
    element.style.removeProperty("--motion-reveal");
  });
}

function hideCopyCanvas(root: HTMLElement) {
  root.querySelectorAll<HTMLCanvasElement>(".hero__copy-canvas").forEach((canvas) => {
    canvas.style.display = "none";
  });
}

/** Shared visual teardown: targets restored, copy canvas hidden, state complete. */
function revealStaticHero(root: HTMLElement) {
  clearTargetStyles(root);
  hideCopyCanvas(root);
  root.dataset.motionState = "complete";
}

/**
 * End of successful motion: static chart, clear copy layer, reveal DOM, optional session key.
 */
function settleToStatic(
  root: HTMLElement,
  layout: Layout | null,
  options: { markSession?: boolean } = {},
) {
  if (layout) {
    drawStaticScene(layout.portrait);
    const { ctx, rect, dpr, canvas } = layout.copy;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    canvas.style.display = "none";
  } else {
    hideCopyCanvas(root);
  }
  clearTargetStyles(root);
  root.dataset.motionState = "complete";
  if (options.markSession) markPlayedThisSession();
}

async function fontsReadyWithin(ms: number): Promise<boolean> {
  if (!document.fonts?.ready) return true;
  let timeoutId = 0;
  try {
    const ready = await Promise.race([
      document.fonts.ready.then(() => true as const),
      new Promise<false>((resolve) => {
        timeoutId = window.setTimeout(() => resolve(false), ms);
      }),
    ]);
    return ready;
  } catch {
    return true; // fonts API error: proceed with fallback metrics
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function setup() {
  const gen = ++setupGen;
  dispose?.();
  dispose = null;

  const root = document.querySelector<HTMLElement>(".hero");
  if (!root || document.body.dataset.page !== "home") {
    clearHeroMotionPending();
    return;
  }

  // Keep the MediaQueryList so mid-session preference changes can stop motion.
  const motionQuery = matchMedia("(prefers-reduced-motion: reduce)");
  const duration = plannedDuration();

  let animationFrameId = 0;
  let ambientFrameId = 0;
  let resizeTimer = 0;
  let failsafeTimer = 0;
  let layout: Layout | null = null;
  let prep: MotionPrep | null = null;
  let targets: TargetBinding[] = [];
  let playing = false;

  const cancelRuntime = () => {
    playing = false;
    cancelAnimationFrame(animationFrameId);
    cancelAnimationFrame(ambientFrameId);
    clearTimeout(resizeTimer);
    clearTimeout(failsafeTimer);
  };

  const redrawStatic = (): boolean => {
    const next = measureLayout(root);
    if (!next) return false;
    layout = next;
    drawStaticScene(next.portrait);
    return true;
  };

  /**
   * Ambient sky after the entrance settles: gentle field-star twinkle,
   * Vega's glow breathing, and a satellite pass roughly every nine seconds.
   * Never runs under reduced motion; canceled by cancelRuntime/dispose.
   */
  const startAmbient = () => {
    if (motionQuery.matches || !layout) return;
    cancelAnimationFrame(ambientFrameId);
    const scene = sceneFor(layout.portrait);
    let start = 0;
    let lastDraw = -Infinity;
    const tick = (t: number) => {
      if (gen !== setupGen || !layout || motionQuery.matches) return;
      if (!start) start = t;
      const ambientT = t - start;
      // Repaint on the ambient budget; a satellite pass is the only motion
      // fast enough to need every frame, so it lifts the cap while it runs.
      const satellitePass =
        ambientT >= SATELLITE_FIRST_PASS &&
        (ambientT - SATELLITE_FIRST_PASS) % SATELLITE_PERIOD < SATELLITE_DURATION;
      if (satellitePass || ambientT - lastDraw >= AMBIENT_FRAME_INTERVAL_MS) {
        lastDraw = ambientT;
        drawStaticScene(layout.portrait, scene, ambientT);
      }
      ambientFrameId = requestAnimationFrame(tick);
    };
    ambientFrameId = requestAnimationFrame(tick);
  };

  /**
   * End the entrance. Session key is written only for a successful natural
   * completion (full or quick settle) — never for focus/resize/failsafe interrupts.
   */
  const completeMotion = (options: { markSession?: boolean } = {}) => {
    if (root.dataset.motionState === "complete" && !playing) return;
    cancelRuntime();
    settleToStatic(root, layout, { markSession: Boolean(options.markSession) });
    root.removeAttribute("data-motion-mode");
    startAmbient();
  };

  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      // Active motion: cancel and leave static without recording a successful play
      cancelAnimationFrame(animationFrameId);
      cancelAnimationFrame(ambientFrameId);
      if (playing) {
        cancelRuntime();
        settleToStatic(root, layout, { markSession: false });
        root.removeAttribute("data-motion-mode");
      }
      animationFrameId = requestAnimationFrame(() => {
        if (!redrawStatic()) {
          revealStaticHero(root);
        } else if (layout) {
          layout.copy.canvas.style.display = "none";
          if (root.dataset.motionState === "complete") startAmbient();
        }
      });
    }, 150);
  };

  const onFocusIn = (event: FocusEvent) => {
    if (root.dataset.motionState === "complete" && !playing) return;
    const target = event.target;
    if (!(target instanceof Element) || !target.closest("a")) return;
    // Interrupt: reveal static hero; do not write the session key
    completeMotion({ markSession: false });
    redrawStatic();
  };

  const onReduceMotionChange = () => {
    if (!motionQuery.matches) return;
    // Preference flipped on while the page is open: stop canvas motion now.
    cancelRuntime();
    revealStaticHero(root);
    root.removeAttribute("data-motion-mode");
    redrawStatic();
  };

  const installListeners = () => {
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    root.addEventListener("focusin", onFocusIn);
    motionQuery.addEventListener("change", onReduceMotionChange);
    dispose = () => {
      cancelRuntime();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      root.removeEventListener("focusin", onFocusIn);
      motionQuery.removeEventListener("change", onReduceMotionChange);
      clearTargetStyles(root);
      hideCopyCanvas(root);
      prep = null;
      targets = [];
    };
  };

  // Reduced motion: reveal immediately, still draw the static chart when possible
  if (motionQuery.matches) {
    revealStaticHero(root);
    redrawStatic();
    installListeners();
    return;
  }

  // Acquire both contexts and measure non-zero rectangles first.
  // Do not hide targets until fonts + particle masks succeed (full path only).
  if (!redrawStatic() || !layout) {
    revealStaticHero(root);
    installListeners();
    return;
  }

  // Pin non-null layout for both quick and full paths (TS narrowing across awaits)
  let activeLayout: Layout = layout;

  installListeners();

  // --- Quick path: later visits in the same session (~250ms settle) ---
  // Skip the font wait and the particle prep so the hero settles at once.
  if (duration <= QUICK_DURATION) {
    targets = collectTargetBindings(root);
    if (!targets.length) {
      revealStaticHero(root);
      startAmbient();
      return;
    }
    if (gen !== setupGen) return;

    root.dataset.motionMode = "quick";
    root.dataset.motionState = "playing";
    hideMotionTargets(targets);
    // Copy canvas unused on quick path; keep hidden
    activeLayout.copy.canvas.style.display = "none";
    playing = true;

    let startTime = 0;
    const stepQuick = (t: number) => {
      if (!playing || gen !== setupGen) return;
      if (!startTime) startTime = t;
      const elapsed = t - startTime;
      const o = smoothstep(0, 1, clamp(elapsed / QUICK_DURATION));
      for (let i = 0; i < targets.length; i++) {
        if (isActionTarget(targets[i].kind)) {
          targets[i].element.style.setProperty("--motion-reveal", String(o));
          targets[i].element.style.opacity = "1";
        } else {
          targets[i].element.style.opacity = String(o);
        }
      }
      if (elapsed < QUICK_DURATION) {
        animationFrameId = requestAnimationFrame(stepQuick);
      } else {
        // Successful quick settle reaffirms the session key
        completeMotion({ markSession: true });
      }
    };
    animationFrameId = requestAnimationFrame(stepQuick);
    return;
  }

  // --- Full path: first visit this session ---
  // Font deadline: skip full prep if fonts stall (glyph metrics may shift)
  const fontsOk = await fontsReadyWithin(FONT_DEADLINE_MS);
  // Abort if a newer setup superseded this run during the await
  if (gen !== setupGen) return;
  if (document.body.dataset.page !== "home") {
    clearHeroMotionPending();
    return;
  }
  if (!fontsOk) {
    revealStaticHero(root);
    redrawStatic();
    startAmbient();
    return;
  }

  // Remeasure after fonts so targets match final metrics
  if (!redrawStatic() || !layout) {
    revealStaticHero(root);
    return;
  }
  activeLayout = layout;

  try {
    prep = prepareMotion(root, activeLayout);
  } catch {
    prep = null;
  }

  if (gen !== setupGen) return;

  if (!prep) {
    revealStaticHero(root);
    redrawStatic();
    startAmbient();
    return;
  }

  targets = collectTargetBindings(root);
  if (!targets.length) {
    revealStaticHero(root);
    redrawStatic();
    startAmbient();
    return;
  }

  if (gen !== setupGen) return;

  // Prep succeeded — only now hide targets and start the shared clock
  root.dataset.motionMode = "full";
  root.dataset.motionState = "playing";
  hideMotionTargets(targets);
  activeLayout.copy.canvas.style.display = "block";
  playing = true;

  // Failsafe armed after targets are hidden — does NOT mark the session key
  failsafeTimer = window.setTimeout(() => {
    if (gen !== setupGen) return;
    completeMotion({ markSession: false });
    redrawStatic();
  }, FAILSAFE_DURATION);

  const motionPrep = prep;
  const motionLayout = activeLayout;
  let startTime = 0;

  const step = (t: number) => {
    if (!playing || gen !== setupGen) return;
    if (!startTime) startTime = t;
    const elapsed = t - startTime;
    drawFrame(elapsed, motionLayout, motionPrep, targets);
    if (elapsed < FULL_DURATION) {
      animationFrameId = requestAnimationFrame(step);
    } else {
      // Successful full completion — only place (with quick settle) that marks session
      completeMotion({ markSession: true });
    }
  };
  animationFrameId = requestAnimationFrame(step);
}
