import { getCollection, type CollectionEntry } from "astro:content";

export type Product = CollectionEntry<"products">;

/**
 * The visible products in list order. The dev server also lists drafts.
 */
export async function getProducts(): Promise<Product[]> {
  const products = await getCollection("products", ({ data }) => import.meta.env.DEV || !data.draft);
  return products.sort((first, second) => first.data.order - second.data.order || first.data.title.localeCompare(second.data.title));
}

export function productAddress(product: Product): string {
  return `/products/${product.id}/`;
}
