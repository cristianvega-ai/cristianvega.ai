// The order of the principles. It takes plain objects, so it does not depend
// on Astro, and the content schema and unit tests can import it.
import { HOME_SECTION_SIZE } from "./latest-entries.ts";

/** The groups of the principles page, in page order. */
export const PRINCIPLE_GROUPS = [
  { id: "building", label: "Building" },
  { id: "working-with-models", label: "Working with models" },
] as const;

export type PrincipleGroupId = (typeof PRINCIPLE_GROUPS)[number]["id"];

/** The group names a principle can take, for the content schema. */
export const PRINCIPLE_GROUP_IDS = PRINCIPLE_GROUPS.map((group) => group.id) as [PrincipleGroupId, ...PrincipleGroupId[]];

export type OrderedPrinciple = { id: string; data: { group: PrincipleGroupId; order: number; featured: boolean } };

const groupPosition = (groupId: PrincipleGroupId) => PRINCIPLE_GROUPS.findIndex((group) => group.id === groupId);

/**
 * The principles in page order: by group, then by their order in the group.
 * Principles with the same order sort by id, so the order is stable from build
 * to build.
 */
export function sortPrinciples<Principle extends OrderedPrinciple>(principles: readonly Principle[]): Principle[] {
  return [...principles].sort((first, second) =>
    groupPosition(first.data.group) - groupPosition(second.data.group)
    || first.data.order - second.data.order
    || first.id.localeCompare(second.id));
}

/** The groups that hold at least one principle, in page order, each with its principles in page order. */
export function groupPrinciples<Principle extends OrderedPrinciple>(principles: readonly Principle[]) {
  const sorted = sortPrinciples(principles);
  return PRINCIPLE_GROUPS
    .map((group) => ({ ...group, principles: sorted.filter((principle) => principle.data.group === group.id) }))
    .filter((group) => group.principles.length > 0);
}

/**
 * The principles the homepage lists: the featured ones in page order, at most
 * four. With no featured principle, the first four in page order.
 */
export function selectHomePrinciples<Principle extends OrderedPrinciple>(principles: readonly Principle[], count = HOME_SECTION_SIZE): Principle[] {
  const sorted = sortPrinciples(principles);
  const featured = sorted.filter((principle) => principle.data.featured);
  return (featured.length > 0 ? featured : sorted).slice(0, Math.max(0, count));
}
