import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import { getPostHref, getPublishedPosts } from "../lib/posts";

export async function GET(context: { site?: URL }) {
  const posts = getPublishedPosts(await getCollection("posts"));
  const site = context.site ?? new URL("https://cristianvega.ai");
  const feedUrl = new URL("/rss.xml", site).toString();
  // Posts are sorted newest first, so this stays deterministic across builds.
  const lastBuildDate = posts[0]?.data.date.toUTCString();

  return rss({
    title: "Cristian Vega Writing",
    description: "Notes on production AI, document systems, and agentic workflows.",
    site,
    xmlns: { atom: "http://www.w3.org/2005/Atom" },
    customData: [
      "<language>en-us</language>",
      `<atom:link href="${feedUrl}" rel="self" type="application/rss+xml" />`,
      lastBuildDate ? `<lastBuildDate>${lastBuildDate}</lastBuildDate>` : ""
    ].join(""),
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.date,
      link: getPostHref(post),
      categories: post.data.tags
    }))
  });
}
