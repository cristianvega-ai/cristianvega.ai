import { getCollection, type CollectionEntry } from "astro:content";

export type BlogPost = CollectionEntry<"blog">;

export async function getPosts(): Promise<BlogPost[]> {
  const posts = await getCollection("blog", ({ data }) => import.meta.env.DEV || !data.draft);
  return posts.sort((a, b) => b.data.date.getTime() - a.data.date.getTime() || a.id.localeCompare(b.id));
}

export function postUrl(post: BlogPost): string {
  return `/writing/${post.id}/`;
}

export function postDate(post: BlogPost): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  }).format(post.data.date);
}

export function readingMinutes(post: BlogPost): number {
  const words = (post.body ?? "").replace(/<[^>]*>/g, " ").match(/\S+/g)?.length ?? 0;
  return Math.max(1, Math.ceil(words / 220));
}
