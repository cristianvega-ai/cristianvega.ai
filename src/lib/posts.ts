// This file re-exports getPublishedPosts from published-posts.mjs and adds
// the date helpers. The split exists so Node tests can import the selector
// without the Astro content loader.
import type { CollectionEntry } from "astro:content";
import { getPublishedPosts as selectPublishedPosts } from "./published-posts.mjs";

type Post = CollectionEntry<"posts">;

export function getPublishedPosts(posts: Post[]): Post[] {
  return selectPublishedPosts(posts);
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
