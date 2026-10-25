// The addresses of a Lab experiment, its results, their clips and their
// scenes. Pure functions, so tests and the media integration share them.
//
//   /lab/<experiment>/                    the experiment page
//   /lab/<experiment>/<result>/           the live viewer of one result
//   /lab/media/<experiment>/clips/...     clips and posters
//   /lab/scenes/<experiment>/<result>/    the model's own page, sandboxed

/** Path segments under /lab/ that the media and the scenes use. No experiment can take them. */
export const RESERVED_EXPERIMENT_SLUGS = ["media", "scenes"] as const;

export type ClipSources = {
  /** AV1 first: it is smaller, and Playwright's Chromium cannot play H.264. */
  av1: string;
  h264: string;
  poster: string;
};

/** Stop the build when an experiment would take a path that the media or the scenes use. */
export function assertExperimentSlug(experiment: string): void {
  if ((RESERVED_EXPERIMENT_SLUGS as readonly string[]).includes(experiment)) {
    throw new Error(`The Lab experiment "${experiment}" takes a reserved path. Rename src/content/lab/${experiment}.md.`);
  }
}

export function experimentAddress(experiment: string): string {
  return `/lab/${experiment}/`;
}

export function resultAddress(experiment: string, result: string): string {
  return `/lab/${experiment}/${result}/`;
}

/** The scene folder. Its index.html is the model's own entry page. */
export function sceneAddress(experiment: string, result: string): string {
  return `/lab/scenes/${experiment}/${result}/`;
}

/** The clip of one result, or "mosaic" for the grid of a whole group. */
export function clipSources(experiment: string, clip: string): ClipSources {
  const media = `/lab/media/${experiment}`;
  return {
    av1: `${media}/clips/${clip}.av1.mp4`,
    h264: `${media}/clips/${clip}.h264.mp4`,
    poster: `${media}/posters/${clip}.webp`,
  };
}
