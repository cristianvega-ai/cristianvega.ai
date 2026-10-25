// The homepage preview: a small clip that trails the pointer over a Lab row,
// so a visitor sees the experiment before opening it. It needs a fine
// pointer and allowed motion; touch and reduced motion show no preview.

/** The preview width in pixels. lab-row-preview.css sets the same width. */
const PREVIEW_WIDTH = 224;
/** How far the preview moves toward the pointer in one frame. Below 1, it trails. */
const FOLLOW_RATE = 0.2;

export function setupRowPreview(): void {
  const rows = [...document.querySelectorAll<HTMLAnchorElement>("a[data-preview-av1]")];
  if (rows.length === 0 || !matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

  const preview = document.createElement("div");
  preview.className = "row-preview";
  preview.setAttribute("aria-hidden", "true");
  const video = document.createElement("video");
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  preview.append(video);
  document.body.append(preview);

  let viewportWidth = innerWidth;
  let targetX = 0;
  let targetY = 0;
  let previewX = 0;
  let previewY = 0;
  let frame = 0;
  let visible = false;
  let currentRow: HTMLAnchorElement | null = null;

  const follow = () => {
    previewX += (targetX - previewX) * FOLLOW_RATE;
    previewY += (targetY - previewY) * FOLLOW_RATE;
    preview.style.transform = `translate3d(${previewX}px, ${previewY}px, 0)`;
    const settled = Math.abs(targetX - previewX) < 0.3 && Math.abs(targetY - previewY) < 0.3;
    frame = visible || !settled ? requestAnimationFrame(follow) : 0;
  };

  const aim = (event: PointerEvent) => {
    targetX = Math.min(event.clientX + 28, viewportWidth - PREVIEW_WIDTH - 16);
    targetY = event.clientY - 150;
  };

  const showRow = (row: HTMLAnchorElement) => {
    if (currentRow === row) return;
    currentRow = row;
    const { previewAv1, previewH264, previewPoster } = row.dataset;
    video.poster = previewPoster ?? "";
    video.replaceChildren(
      Object.assign(document.createElement("source"), { src: previewAv1, type: 'video/mp4; codecs="av01.0.04M.08"' }),
      Object.assign(document.createElement("source"), { src: previewH264, type: "video/mp4" }),
    );
    video.load();
  };

  addEventListener("resize", () => {
    viewportWidth = innerWidth;
  });

  for (const row of rows) {
    row.addEventListener("pointerenter", (event) => {
      if (reduceMotion.matches) return;
      aim(event);
      if (!visible) {
        previewX = targetX;
        previewY = targetY + 12;
      }
      visible = true;
      showRow(row);
      video.play().catch(() => {});
      preview.classList.add("row-preview--visible");
      if (!frame) frame = requestAnimationFrame(follow);
    });
    row.addEventListener("pointermove", aim);
    row.addEventListener("pointerleave", () => {
      visible = false;
      preview.classList.remove("row-preview--visible");
      video.pause();
    });
  }

  addEventListener("pagehide", () => {
    visible = false;
    preview.classList.remove("row-preview--visible");
    video.pause();
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  });
}
