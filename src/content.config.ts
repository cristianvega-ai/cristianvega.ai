import { defineCollection, reference } from "astro:content";
import { z } from "astro/zod";
import { glob } from "astro/loaders";
import { PRINCIPLE_GROUP_IDS } from "./shared/content/principle-groups.ts";

// A principle is one short statement and the reason behind it. The principles
// page lists them by group and order. Its id is the anchor that links to it,
// such as /principles/#less-is-more, so keep an id once it is published.
const principles = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/principles" }),
  schema: z.object({
    /** The statement, such as "Less is more". */
    title: z.string().min(1),
    group: z.enum(PRINCIPLE_GROUP_IDS),
    /** The position in the group. */
    order: z.number().int(),
    /** The day the principle last changed. The principles page shows the newest of these days. */
    updated: z.coerce.date(),
    /** The homepage lists the featured principles, at most four. */
    featured: z.boolean().default(false),
    draft: z.boolean().default(true),
  }),
});

// An article or an experiment names the principles it follows. The build
// fails when a name has no principle.
const principleNames = z.array(reference("principles")).default([]);

const writing = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/writing" }),
  schema: z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    date: z.coerce.date(),
    topic: z.string().min(1),
    draft: z.boolean().default(true),
    series: z.string().optional(),
    principles: principleNames,
  }),
});

// Products stay drafts until the owner announces them. Read the authoring reference linked from AGENTS.md.
const products = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/products" }),
  schema: z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    // The release date. The homepage and the products page show the newest first.
    date: z.coerce.date(),
    draft: z.boolean().default(true),
    url: z.url({ protocol: /^https$/ }).optional(),
    status: z.string().min(1).optional(),
  }),
});

// A Lab experiment is one prompt and the results it produced. One result makes
// a single piece; two or more make a group, one result per model. Each
// result's clip, poster and scene live in assets/lab/<experiment>/, and only a
// published experiment copies them into the site.
const lab = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/lab" }),
  schema: z.object({
    title: z.string().min(1),
    /** A short name for the scene bar and the browser tab, such as "Floating castles". */
    label: z.string().min(1),
    description: z.string().min(1),
    date: z.coerce.date(),
    draft: z.boolean().default(true),
    /** The prompt exactly as the models received it. */
    prompt: z.string().min(1),
    /** A line under the results, such as how the clips were captured. */
    note: z.string().min(1).optional(),
    results: z.array(z.object({
      name: z.string().min(1),
      slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      /** The reasoning effort the model ran at, when the run set one. */
      effort: z.string().min(1).optional(),
    })).min(1),
    principles: principleNames,
  }),
});

export const collections = { principles, writing, products, lab };
