import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import { getPostHref, getPublishedPosts } from "../lib/posts";

export async function GET(context: { site?: URL }) {
  const posts = getPublishedPosts(await getCollection("posts"));

  return rss({
    title: "Cristian Vega Writing",
    description: "Notes on production AI, document systems, and agentic workflows.",
    site: context.site ?? new URL("https://cristianvega.ai"),
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.date,
      link: getPostHref(post),
      categories: post.data.tags
    }))
  });
}
