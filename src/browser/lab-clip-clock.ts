// The Lab clips: muted loops that play only while they are on screen.
//
// - Every clip on a page follows one clock, so each model shows the same
//   moment of the shared camera path, as in the comparison video.
// - The pause control stops and starts every clip on the page. It reads
//   "Play clips" when the clips stand still.
// - With reduced motion the clips start on their posters. The visitor can
//   still play them with the control.
// - When the browser refuses to play, the posters stay and the control
//   offers to play.
import { clipClockTime } from "../shared/lab/clip-clock.ts";

let isSetUp = false;

export function setupClipClock(): void {
  if (isSetUp) return;
  isSetUp = true;
  const clips = [...document.querySelectorAll<HTMLVideoElement>("video[data-clip]")];
  if (clips.length === 0) return;
  const controls = [...document.querySelectorAll<HTMLButtonElement>("[data-clip-pause]")];
  const clockStart = performance.now();
  const visibleClips = new Set<HTMLVideoElement>();
  let paused = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const showControls = () => {
    for (const control of controls) {
      control.textContent = paused ? "Play clips" : "Pause clips";
      control.hidden = false;
    }
  };

  const isLoadedAt = (clip: HTMLVideoElement, time: number) => {
    for (let rangeIndex = 0; rangeIndex < clip.buffered.length; rangeIndex += 1) {
      if (clip.buffered.start(rangeIndex) <= time && clip.buffered.end(rangeIndex) >= time) return true;
    }
    return false;
  };

  const play = (clip: HTMLVideoElement) => {
    const start = () => {
      if (paused || !visibleClips.has(clip)) return;
      // Cloudflare's static assets do not answer byte ranges, so a seek
      // beyond the loaded part restarts the download and lags. The clip
      // waits on its poster until its download covers the clock time. When
      // the download stops short, the clip plays from where it is.
      const target = clipClockTime((performance.now() - clockStart) / 1000, clip.duration);
      if (!isLoadedAt(clip, target) && clip.networkState === HTMLMediaElement.NETWORK_LOADING) {
        clip.addEventListener("progress", start, { once: true });
        return;
      }
      if (isLoadedAt(clip, target)) clip.currentTime = target;
      clip.play().catch(() => {
        paused = true;
        for (const other of clips) other.pause();
        showControls();
      });
    };
    if (clip.readyState >= HTMLMediaElement.HAVE_METADATA) start();
    else clip.addEventListener("loadedmetadata", start, { once: true });
  };

  const update = (clip: HTMLVideoElement) => {
    if (!paused && visibleClips.has(clip)) play(clip);
    else clip.pause();
  };

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const clip = entry.target as HTMLVideoElement;
      if (entry.isIntersecting) visibleClips.add(clip);
      else visibleClips.delete(clip);
      update(clip);
    }
  }, { threshold: 0.2 });

  for (const control of controls) {
    control.addEventListener("click", () => {
      paused = !paused;
      showControls();
      clips.forEach(update);
    });
  }

  const start = () => clips.forEach((clip) => observer.observe(clip));
  addEventListener("pagehide", () => {
    observer.disconnect();
    visibleClips.clear();
    for (const clip of clips) clip.pause();
  });
  addEventListener("pageshow", (event) => {
    if (event.persisted) start();
  });
  showControls();
  start();
}
