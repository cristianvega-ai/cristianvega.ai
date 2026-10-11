// The facts about the site owner that more than one page prints.

/** The owner's name. It is the site name, the article author, and the copyright holder. */
export const SITE_NAME = "Cristian Vega";
/** The owner's job title. The page title, the profile eyebrow, and the structured data show it. */
export const JOB_TITLE = "AI Engineering Leader";
/** The owner's profiles. The header links them, and the structured data names them. */
export const PROFILE_LINKS = [
  { label: "linkedin", href: "https://www.linkedin.com/in/cristianvega-ai" },
  { label: "x", href: "https://x.com/cristianvega" },
  { label: "github", href: "https://github.com/cristianvega-ai" },
] as const;

/** The kind of each page. The body names it in data-page, and the header marks the current link from it. */
export type PageKind = "home" | "about" | "writing" | "article" | "products" | "product" | "error";
