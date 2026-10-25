// The newest entries of a collection, for the homepage sections. It takes
// plain objects, so it does not depend on Astro and unit tests can call it.

export type DatedEntry = { id: string; data: { date: Date } };

/** The homepage shows this many entries in each section. */
export const HOME_SECTION_SIZE = 4;

/**
 * The newest `count` entries, newest first. Entries with the same date sort
 * by id, so the order is stable from build to build.
 */
export function selectLatestEntries<Entry extends DatedEntry>(entries: readonly Entry[], count = HOME_SECTION_SIZE): Entry[] {
  return [...entries]
    .sort((first, second) => second.data.date.getTime() - first.data.date.getTime() || first.id.localeCompare(second.id))
    .slice(0, Math.max(0, count));
}
