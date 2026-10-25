import { getCollection, type CollectionEntry } from "astro:content";
import type { EntryRowData } from "./entry-row.ts";
import { assertExperimentSlug, clipSources, experimentAddress, type ClipSources } from "../lab/media-paths.ts";

export type Experiment = CollectionEntry<"lab">;
export type ExperimentResult = Experiment["data"]["results"][number];

/**
 * The visible experiments, newest first. The dev server also lists drafts.
 * The build stops when an experiment takes a reserved path or repeats a
 * result slug.
 */
export async function getExperiments(): Promise<Experiment[]> {
  const experiments = await getCollection("lab", ({ data }) => import.meta.env.DEV || !data.draft);
  for (const experiment of experiments) {
    assertExperimentSlug(experiment.id);
    const slugs = experiment.data.results.map((result) => result.slug);
    if (new Set(slugs).size !== slugs.length) throw new Error(`The Lab experiment "${experiment.id}" repeats a result slug.`);
  }
  return experiments.sort((first, second) => second.data.date.getTime() - first.data.date.getTime() || first.id.localeCompare(second.id));
}

/** A group is one prompt run by several models. */
export function isGroup(experiment: Experiment): boolean {
  return experiment.data.results.length > 1;
}

/** A group shows the mosaic of all its results; a single piece shows its own clip. */
export function experimentClip(experiment: Experiment): ClipSources {
  return clipSources(experiment.id, isGroup(experiment) ? "mosaic" : experiment.data.results[0].slug);
}

/** "8 models" for a group, or the one model's name. */
export function experimentMeta(experiment: Experiment): string {
  return isGroup(experiment) ? `${experiment.data.results.length} models` : experiment.data.results[0].name;
}

export function experimentDate(experiment: Experiment): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(experiment.data.date);
}

/** The transition key of an experiment: its row or card title and its page heading share it. */
export function experimentMorphKey(experiment: Experiment): string {
  return `lab/${experiment.id}`;
}

export function experimentRow(experiment: Experiment): EntryRowData {
  return {
    href: experimentAddress(experiment.id),
    title: experiment.data.title,
    morphKey: experimentMorphKey(experiment),
    meta: experimentMeta(experiment),
    draft: experiment.data.draft,
    preview: experimentClip(experiment),
  };
}
