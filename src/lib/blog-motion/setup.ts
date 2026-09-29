import { buildNetwork, drawNetwork, drawSignal, placeNetwork } from "./network";

const DURATION = 2000;

export function setupBlogMotion(): () => void {
  const root = document.querySelector<HTMLElement>("[data-lyra]");
  if (!root) return () => {};

  const events = new AbortController();
  const options = { signal: events.signal };
  const canvas = root.querySelector("canvas");
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) return () => events.abort();

  let ids: string[];
  try {
    const input: unknown = JSON.parse(root.dataset.inputs ?? "[]");
    if (!Array.isArray(input) || !input.every((id) => typeof id === "string")) throw new Error("Invalid scene inputs");
    ids = input;
  } catch {
    return () => events.abort();
  }

  const network = buildNetwork(ids);
  const list = document.querySelector<HTMLElement>(".blog-index__list");
  const card = root.querySelector<HTMLElement>(".lyra-scene__card");
  const cardTitle = root.querySelector<HTMLElement>("[data-scene-title]");
  const cardMeta = root.querySelector<HTMLElement>("[data-scene-meta]");
  const styles = getComputedStyle(document.documentElement);
  const sky = styles.getPropertyValue("--sky").trim();
  const text = styles.getPropertyValue("--mast-text").trim();
  const meta = styles.getPropertyValue("--mast-meta").trim();
  const ground = styles.getPropertyValue("--ink").trim();
  const background = document.createElement("canvas");
  const bg = background.getContext("2d");
  if (!bg) return () => events.abort();

  const preference = matchMedia("(prefers-reduced-motion: reduce)");
  let reduced = preference.matches;
  let disposed = false;
  let visible = true;
  let frame = 0;
  let lastTime = 0;
  let elapsed = reduced ? DURATION : 0;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let selected = "";
  let signal = network.signals.get(selected);
  const scratch = { x: 0, y: 0 };

  // Precompute the noise so each frame only selects a string.
  const decodes = reduced ? [] : [...document.querySelectorAll<HTMLElement>("[data-decode]")].map((element) => {
    const overlay = document.createElement("span");
    overlay.className = "decode-noise";
    overlay.setAttribute("aria-hidden", "true");
    const source = element.textContent ?? "";
    const samples = Array.from({ length: 12 }, (_, step) => source.replace(/[^\s]/g, (char, index: number) => String((char.charCodeAt(0) + index + step * 7) % 10)));
    element.classList.add("decode-target");
    element.append(overlay);
    return { element, overlay, samples, sample: -1 };
  });

  function clearDecodes() {
    for (const decode of decodes) {
      decode.overlay.remove();
      decode.element.classList.remove("decode-target");
    }
    decodes.length = 0;
  }

  function paint() {
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx!.clearRect(0, 0, width, height);
    ctx!.drawImage(background, 0, 0, width, height);
    if (signal) drawSignal(ctx!, signal, reduced ? DURATION : elapsed, sky, scratch);
  }

  function halt() {
    cancelAnimationFrame(frame);
    frame = 0;
    lastTime = 0;
  }

  function schedule() {
    if (!disposed && !reduced && visible && !document.hidden && elapsed < DURATION && !frame) {
      root!.dataset.motionState = "playing";
      frame = requestAnimationFrame(tick);
    }
  }

  function tick(now: number) {
    frame = 0;
    if (disposed || document.hidden || !visible || reduced) return;
    elapsed = Math.min(DURATION, elapsed + (lastTime ? Math.min(now - lastTime, 100) : 0));
    lastTime = now;
    paint();
    for (const decode of decodes) {
      const sample = Math.min(11, Math.floor(elapsed / 80));
      if (sample !== decode.sample) {
        decode.overlay.textContent = decode.samples[sample];
        decode.sample = sample;
      }
    }
    if (elapsed >= 1000) clearDecodes();
    if (elapsed >= DURATION) root!.dataset.motionState = "still";
    else schedule();
  }

  function measure() {
    if (disposed) return;
    const rect = root!.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    if (!width || !height) return;
    dpr = Math.min(devicePixelRatio || 1, 2);
    canvas!.width = background.width = Math.ceil(width * dpr);
    canvas!.height = background.height = Math.ceil(height * dpr);
    // Stacked, the network takes the full width. It keeps room on the left for its labels.
    const stacked = !list || getComputedStyle(list.parentElement!).display !== "grid";
    const copyRight = stacked ? 12 : list.getBoundingClientRect().right - rect.left;
    placeNetwork(network, width, height, copyRight, stacked);
    bg!.setTransform(dpr, 0, 0, dpr, 0, 0);
    bg!.clearRect(0, 0, width, height);
    bg!.fillStyle = meta;
    for (let i = 0; i < 170; i++) {
      const x = ((i * .618034) % 1) * width;
      const y = ((i * .754877) % 1) * height;
      bg!.globalAlpha = .1 + (i % 5) * .045;
      bg!.fillRect(x, y, i % 3 === 0 ? 1 : .6, i % 3 === 0 ? 1 : .6);
    }
    drawNetwork(bg!, network, sky, text, meta, ground);
    paint();
    schedule();
  }

  function select(item?: HTMLElement) {
    const id = item?.dataset.postId ?? "";
    if (id === selected) return;
    selected = id;
    signal = network.signals.get(id);
    elapsed = reduced ? DURATION : 0;
    lastTime = 0;
    root!.dataset.activePost = id;
    if (cardTitle) cardTitle.textContent = item?.querySelector("h2")?.textContent ?? "";
    if (cardMeta) cardMeta.textContent = item?.querySelector(".post-list__meta")?.textContent ?? "";
    card?.classList.toggle("is-active", Boolean(item));
    paint();
    schedule();
  }

  for (const item of document.querySelectorAll<HTMLElement>("[data-post-id]")) {
    item.addEventListener("pointerenter", () => select(item), options);
    item.addEventListener("focusin", () => select(item), options);
    item.addEventListener("pointerleave", () => {
      const focused = document.activeElement?.closest<HTMLElement>("[data-post-id]");
      select(focused ?? undefined);
    }, options);
    item.addEventListener("focusout", () => select(), options);
  }

  preference.addEventListener("change", () => {
    reduced = preference.matches;
    halt();
    clearDecodes();
    elapsed = DURATION;
    root.dataset.motionState = "still";
    paint();
  }, options);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) halt();
    else schedule();
  }, options);

  const resize = new ResizeObserver(measure);
  resize.observe(root);
  window.addEventListener("resize", measure, options);
  const intersection = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) schedule();
    else halt();
  });
  intersection.observe(root);
  root.dataset.motionState = reduced ? "still" : "playing";
  measure();
  document.fonts.ready.then(() => { if (!disposed) measure(); });

  return () => {
    disposed = true;
    halt();
    clearDecodes();
    resize.disconnect();
    intersection.disconnect();
    events.abort();
  };
}

// Make wide code and figures reachable by keyboard, and show the copy button.
export function setupArticle(): void {
  for (const element of document.querySelectorAll<HTMLElement>(".prose pre, .figure__panel")) {
    element.tabIndex = 0;
    element.setAttribute("role", "region");
    element.setAttribute("aria-label", element.matches("pre") ? "Code example" : "Pipeline diagram");
  }

  const button = document.querySelector<HTMLButtonElement>("[data-copy-link]");
  if (!button || !navigator.clipboard?.writeText) return;
  button.hidden = false;
  button.addEventListener("click", async () => {
    const status = document.querySelector<HTMLElement>(".share-status");
    try {
      await navigator.clipboard.writeText(button.dataset.copyLink!);
      if (status) status.textContent = "Link copied.";
    } catch {
      if (status) status.textContent = "Copy the address from your browser to share this post.";
    }
  });
}
