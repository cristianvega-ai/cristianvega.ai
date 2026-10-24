// The data of one row in an entry list: the homepage sections, the index
// pages and the more-writing list all print rows from it.
import type { ClipSources } from "../lab/media-paths.ts";

export type EntryRowData = {
  href: string;
  title: string;
  /** The key that pairs the row title with the page heading in a page transition. */
  morphKey: string;
  /** A short value on the right, such as a date. */
  meta?: string;
  /** A sentence after the title, such as what a product does. */
  description?: string;
  draft: boolean;
  /** A clip that trails the pointer over the row on the homepage, for Lab rows. */
  preview?: ClipSources;
};
