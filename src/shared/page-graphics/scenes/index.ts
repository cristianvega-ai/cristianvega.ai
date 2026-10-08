import type { CanvasHandle } from "../mount.ts";

/** A page graphic mounts itself in the container and returns the handle, or null when canvas is missing. */
export type PageGraphicMount = (container: HTMLElement) => CanvasHandle | null;

// One entry for each page. The import is dynamic, so a page loads only its own drawing code.
const graphics: Record<string, () => Promise<PageGraphicMount>> = {
  about: () => import("./about.ts").then((module) => module.mountAbout),
  products: () => import("./products.ts").then((module) => module.mountProducts),
  "404": () => import("./404.ts").then((module) => module.mountNotFound),
  writing: () => import("./writing.ts").then((module) => module.mountWriting),
};

/**
 * Mount the graphic that `container[data-graphic]` names. Hide the container when
 * the page has no such graphic or the browser cannot draw it, so an empty band never stays.
 */
export async function mountPageGraphic(container: HTMLElement): Promise<CanvasHandle | null> {
  const load = graphics[container.dataset.graphic ?? ""];
  let handle: CanvasHandle | null = null;
  try {
    handle = load ? (await load())(container) : null;
  } catch {
    handle = null;
  }
  if (!handle) container.hidden = true;
  return handle;
}
