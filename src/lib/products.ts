import { getCollection, type CollectionEntry } from "astro:content";
import { assertProductCapacity } from "./page-graphics/scenes/products.ts";

export type Product = CollectionEntry<"products">;

/**
 * The visible products in list order. The dev server also lists drafts.
 * Each published product needs a slot in the products graphic, so the build fails when they do not fit.
 */
export async function getProducts(): Promise<Product[]> {
  const products = await getCollection("products", ({ data }) => import.meta.env.DEV || !data.draft);
  assertProductCapacity(products.filter(({ data }) => !data.draft).length);
  return products.sort((a, b) => a.data.order - b.data.order || a.data.title.localeCompare(b.data.title));
}

export function productUrl(product: Product): string {
  return `/products/${product.id}/`;
}
