import { getCollection, type CollectionEntry } from "astro:content";

export type Article = CollectionEntry<"writing">;

export async function getArticles(): Promise<Article[]> {
  const articles = await getCollection("writing", ({ data }) => import.meta.env.DEV || !data.draft);
  return articles.sort((a, b) => b.data.date.getTime() - a.data.date.getTime() || a.id.localeCompare(b.id));
}

export function articleAddress(article: Article): string {
  return `/writing/${article.id}/`;
}

export function articleDate(article: Article): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  }).format(article.data.date);
}

export function readingMinutes(article: Article): number {
  const words = (article.body ?? "").replace(/<[^>]*>/g, " ").match(/\S+/g)?.length ?? 0;
  return Math.max(1, Math.ceil(words / 220));
}
