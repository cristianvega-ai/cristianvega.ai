// The Lab clips: muted loops that play together.
//
// - Every clip on a page starts at the same moment and pauses and resumes
//   with the others, so each model in a group shows the same moment of the
//   shared camera path, as in the comparison video. Cloudflare's static assets
//   do not answer byte ranges, so the browser cannot seek a clip. Playing
//   together keeps the clips in step without a seek.
// - The clips start once all of them have loaded, or after a short wait when
//   a browser loads only on play. They play while at least one is on screen.
// - The pause control stops and starts every clip. It reads "Play clips" when
//   the clips stand still.
// - With reduced motion the clips start on their posters. The visitor can
//   still play them with the control.
// - When the browser refuses to play, the posters stay and the control offers
//   to play.

/** How long the clips wait for each other before they start anyway. */
const LOAD_WAIT = 3000;
/** The share of a clip that must be on screen for it to count as visible. */
const VISIBLE_SHARE = 0.2;

let isSetUp = false;

export function setupClipPlayback(): void {
  if (isSetUp) return;
  isSetUp = true;
  const clips = [...document.querySelectorAll<HTMLVideoElement>("video[data-clip]")];
  if (clips.length === 0) return;
  const controls = [...document.querySelectorAll<HTMLButtonElement>("[data-clip-pause]")];
  const visibleClips = new Set<HTMLVideoElement>();
  let paused = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let waitTimer = 0;
  let waitedEnough = false;

  const showControls = () => {
    for (const control of controls) {
      control.textContent = paused ? "Play clips" : "Pause clips";
      control.hidden = false;
    }
  };

  // A clip that failed to load must not hold the others back.
  const isReady = (clip: HTMLVideoElement) => clip.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA || clip.error !== null;

  const refuse = () => {
    paused = true;
    for (const clip of clips) clip.pause();
    showControls();
  };

  const update = () => {
    if (paused || visibleClips.size === 0) {
      for (const clip of clips) clip.pause();
      return;
    }
    if (!waitedEnough && !clips.every(isReady)) {
      if (!waitTimer) {
        waitTimer = window.setTimeout(() => {
          waitedEnough = true;
          update();
        }, LOAD_WAIT);
      }
      return;
    }
    clearTimeout(waitTimer);
    waitTimer = 0;
    // One loop starts every clip in the same task, so they begin together.
    for (const clip of clips) {
      if (clip.paused) clip.play().catch(refuse);
    }
  };

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const clip = entry.target as HTMLVideoElement;
      if (entry.isIntersecting) visibleClips.add(clip);
      else visibleClips.delete(clip);
    }
    update();
  }, { threshold: VISIBLE_SHARE });

  for (const clip of clips) clip.addEventListener("canplaythrough", update);
  for (const control of controls) {
    control.addEventListener("click", () => {
      paused = !paused;
      waitedEnough = true;
      showControls();
      update();
    });
  }

  const start = () => clips.forEach((clip) => observer.observe(clip));
  addEventListener("pagehide", () => {
    observer.disconnect();
    visibleClips.clear();
    clearTimeout(waitTimer);
    waitTimer = 0;
    for (const clip of clips) clip.pause();
  });
  addEventListener("pageshow", (event) => {
    if (event.persisted) start();
  });
  showControls();
  start();
}
