/**
 * Select non-draft posts, newest first.
 * Kept as plain ESM so Node tests can import it without the Astro content loader.
 *
 * @template {{ data: { draft: boolean, date: Date } }} T
 * @param {T[]} posts
 * @returns {T[]}
 */
export function getPublishedPosts(posts) {
  return posts
    .filter((post) => !post.data.draft)
    .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}
