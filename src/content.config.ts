import { defineCollection } from "astro:content";
import { z } from "astro/zod";
import { glob } from "astro/loaders";

const writing = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/writing" }),
  schema: z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    date: z.coerce.date(),
    topic: z.string().min(1),
    draft: z.boolean().default(true),
    series: z.string().optional(),
  }),
});

// Products stay drafts until the owner announces them. Read the authoring reference linked from AGENTS.md.
const products = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/products" }),
  schema: z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    draft: z.boolean().default(true),
    // Ascending. Products with the same order sort by title.
    order: z.number().int().default(0),
    url: z.url({ protocol: /^https$/ }).optional(),
    status: z.string().min(1).optional(),
  }),
});

export const collections = { writing, products };
