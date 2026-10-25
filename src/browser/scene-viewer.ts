// The live viewer of one Lab result.
//
// - The poster holds the stage until the model's page loads. The scene then
//   fades in over it, and the status dot turns azure.
// - The arrows step to the neighbouring result and replace this page in the
//   history, so the browser's back button returns to the experiment. The
//   left and right arrow keys do the same while the scene does not have
//   focus. page-transitions.js slides the next scene in from its side.
// - The back link and Escape return to the experiment. When the experiment
//   page is the previous history entry, they go back through history.
// - The full-screen button shows only where the browser allows it.

/** The scene draws its first frames before it fades in. */
const LIVE_DELAY = 300;

type NavigationEntry = { url: string | null };
type NavigationHistory = { currentEntry: { index: number } | null; entries(): NavigationEntry[] };

function previousEntryPath(): string | null {
  const navigationHistory = (window as unknown as { navigation?: NavigationHistory }).navigation;
  const index = navigationHistory?.currentEntry?.index;
  if (!navigationHistory || index === undefined || index < 1) return null;
  const url = navigationHistory.entries()[index - 1]?.url;
  if (!url) return null;
  const address = new URL(url);
  return address.origin === location.origin ? address.pathname : null;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.matches("input, textarea, select"));
}

const hasModifier = (event: MouseEvent | KeyboardEvent) => event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;

export function setupSceneViewer(): void {
  const stage = document.querySelector<HTMLElement>("[data-scene-stage]");
  const bar = document.querySelector<HTMLElement>(".scene-bar");
  const frame = stage?.querySelector<HTMLIFrameElement>("iframe");
  const back = document.querySelector<HTMLAnchorElement>("[data-scene-back]");
  if (!stage || !bar || !frame || !back) return;
  const steps = [...document.querySelectorAll<HTMLAnchorElement>("a[data-direction]")];
  const fullScreen = document.querySelector<HTMLButtonElement>("[data-scene-full-screen]");

  let isLive = false;
  const showLive = () => {
    if (isLive) return;
    isLive = true;
    setTimeout(() => {
      stage.classList.add("scene-stage--live");
      bar.classList.add("scene-bar--live");
    }, LIVE_DELAY);
  };
  // The frame can finish loading before this module runs, and its opaque
  // origin hides its state. The page load event always waits for the frame,
  // so one of the two events arrives after the scene has loaded.
  frame.addEventListener("load", showLive, { once: true });
  if (document.readyState === "complete") showLive();
  else addEventListener("load", showLive, { once: true });

  const returnsThroughHistory = previousEntryPath() === new URL(back.href).pathname;
  const goBack = () => {
    if (returnsThroughHistory) history.back();
    else location.href = back.href;
  };

  back.addEventListener("click", (event) => {
    if (event.button !== 0 || hasModifier(event) || !returnsThroughHistory) return;
    event.preventDefault();
    goBack();
  });

  for (const step of steps) {
    step.addEventListener("click", (event) => {
      if (event.button !== 0 || hasModifier(event)) return;
      event.preventDefault();
      location.replace(step.href);
    });
  }

  if (fullScreen && document.fullscreenEnabled) {
    fullScreen.hidden = false;
    fullScreen.addEventListener("click", () => {
      stage.requestFullscreen().catch(() => {});
    });
  }

  const followKey = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || hasModifier(event) || isTypingTarget(event.target)) return;
    if (event.key === "ArrowLeft") steps.find((step) => step.dataset.direction === "previous")?.click();
    if (event.key === "ArrowRight") steps.find((step) => step.dataset.direction === "next")?.click();
    if (event.key === "Escape" && !document.fullscreenElement) goBack();
  };

  addEventListener("keydown", followKey);
  addEventListener("pagehide", () => removeEventListener("keydown", followKey));
  addEventListener("pageshow", (event) => {
    if (event.persisted) addEventListener("keydown", followKey);
  });
}
