import { getCollection, type CollectionEntry } from "astro:content";
import type { EntryRowData } from "./entry-row.ts";

export type Product = CollectionEntry<"products">;

/**
 * The visible products, newest first. The dev server also lists drafts.
 */
export async function getProducts(): Promise<Product[]> {
  const products = await getCollection("products", ({ data }) => import.meta.env.DEV || !data.draft);
  return products.sort((first, second) => second.data.date.getTime() - first.data.date.getTime() || first.id.localeCompare(second.id));
}

export function productAddress(product: Product): string {
  return `/products/${product.id}/`;
}

/** The transition key of a product: its row title and its page heading share it. */
export function productMorphKey(product: Product): string {
  return `products/${product.id}`;
}

export function productRow(product: Product): EntryRowData {
  return {
    href: productAddress(product),
    title: product.data.title,
    morphKey: productMorphKey(product),
    description: product.data.description,
    draft: product.data.draft,
  };
}
