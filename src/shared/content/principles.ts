import { getCollection, type CollectionEntry } from "astro:content";
import type { EntryRowData } from "./entry-row.ts";
import { sortPrinciples } from "./principle-groups.ts";

export type Principle = CollectionEntry<"principles">;

/** The principle names in the front matter of an article or an experiment. */
export type PrincipleNames = readonly { id: string }[];

export const PRINCIPLES_ADDRESS = "/principles/";

/** The visible principles in page order. The dev server also lists drafts. */
export async function getPrinciples(): Promise<Principle[]> {
  return sortPrinciples(await getCollection("principles", ({ data }) => import.meta.env.DEV || !data.draft));
}

/** The link to one principle: the principles page, scrolled to it. */
export function principleAddress(principle: Principle): string {
  return `${PRINCIPLES_ADDRESS}#${principle.id}`;
}

/** The transition key of a principle: its row title and its statement on the principles page share it. */
export function principleMorphKey(principle: Principle): string {
  return `principles/${principle.id}`;
}

export function principleRow(principle: Principle): EntryRowData {
  return { href: principleAddress(principle), title: principle.data.title, morphKey: principleMorphKey(principle), draft: principle.data.draft, star: true };
}

/**
 * The visible principles that an article or an experiment names, in page
 * order. A principle that is still a draft stays out of a published page.
 */
export function namedPrinciples(names: PrincipleNames, principles: readonly Principle[]): Principle[] {
  const ids = new Set(names.map((name) => name.id));
  return principles.filter((principle) => ids.has(principle.id));
}

/** The day the newest principle changed, as a machine date and as "25 Oct 2026". */
export function principlesUpdated(principles: readonly Principle[]): { iso: string; label: string } {
  const newest = new Date(Math.max(...principles.map((principle) => principle.data.updated.getTime())));
  return {
    iso: newest.toISOString().slice(0, 10),
    label: new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(newest),
  };
}
