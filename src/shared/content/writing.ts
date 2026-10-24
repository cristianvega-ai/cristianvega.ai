import { getCollection, type CollectionEntry } from "astro:content";
import type { EntryRowData } from "./entry-row.ts";

export type Article = CollectionEntry<"writing">;

export async function getArticles(): Promise<Article[]> {
  const articles = await getCollection("writing", ({ data }) => import.meta.env.DEV || !data.draft);
  return articles.sort((first, second) => second.data.date.getTime() - first.data.date.getTime() || first.id.localeCompare(second.id));
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

/** The day and month only, for lists that group articles by year. */
export function articleDayAndMonth(article: Article): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(article.data.date);
}

export function articleYear(article: Article): number {
  return article.data.date.getUTCFullYear();
}

/** The transition key of an article: its row title and its page heading share it. */
export function articleMorphKey(article: Article): string {
  return `writing/${article.id}`;
}

export function articleRow(article: Article, meta = articleDate(article)): EntryRowData {
  return { href: articleAddress(article), title: article.data.title, morphKey: articleMorphKey(article), meta, draft: article.data.draft };
}
