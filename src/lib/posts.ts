import type { CollectionEntry } from "astro:content";

export type Post = CollectionEntry<"posts">;

export function getPublishedPosts(posts: Post[]): Post[] {
  return posts
    .filter((post) => !post.data.draft)
    .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

export function getPostHref(post: Post): string {
  return `/posts/${post.id}/`;
}

export function formatPostDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");

  return `${year}.${month}`;
}

export function formatMachineDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function formatReadableDate(date: Date): string {
  return new Intl.DateTimeFormat("en", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}
