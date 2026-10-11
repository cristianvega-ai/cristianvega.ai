import { entranceProgress } from "../motion/clock.ts";
import { clamp } from "../motion/easing.ts";

// The globe labels are SVG text over the canvas. Each one fades in on the canvas clock:
// its animation is paused, and every frame sets its time from the entrance progress.

export interface LabelAnimations {
  /** Bind paused animations once per entrance. Return the cleanup. */
  attach(): () => void;
  /** Set each label to its share of the entrance. A complete entrance finishes the labels and lets them go. */
  update(progress: number, entranceComplete: boolean): void;
}

export function createLabelAnimations(labels: NodeListOf<SVGTextElement>): LabelAnimations {
  const bindings: { animation: Animation; start: number; span: number }[] = [];

  function detach() {
    for (const binding of bindings) binding.animation.cancel();
    bindings.length = 0;
  }

  function attach() {
    try {
      for (const label of labels) {
        const delay = label.classList.contains("lyra-globe__label--caption") ? 500 : 1400;
        const start = entranceProgress(delay);
        const animation = label.animate([{ opacity: 0 }, { opacity: label.getAttribute("opacity")! }], {
          duration: 1,
          easing: "ease-out",
          fill: "both",
        });
        bindings.push({ animation, start, span: entranceProgress(delay + 700) - start });
        animation.pause();
        animation.currentTime = 0;
      }
    } catch (error) {
      detach();
      throw error;
    }
    return detach;
  }

  function update(progress: number, entranceComplete: boolean) {
    if (entranceComplete) {
      for (let i = 0; i < bindings.length; i++) bindings[i].animation.finish();
      // Restore the model opacity after the entrance.
      detach();
    }
    for (let i = 0; i < bindings.length; i++) {
      const binding = bindings[i];
      binding.animation.currentTime = clamp((progress - binding.start) / binding.span);
    }
  }

  return { attach, update };
}
