// The facts about the site owner that more than one page prints.

/** The owner's name. It is the site name, the article author, and the homepage heading. */
export const SITE_NAME = "Cristian Vega";
/** The owner's job title. The homepage title, the identity line, and the structured data show it. */
export const JOB_TITLE = "AI Engineering Leader";
/** The owner's profiles. The homepage links them as icons, and the structured data names them. */
export const PROFILE_LINKS = [
  { label: "linkedin", name: "LinkedIn", href: "https://www.linkedin.com/in/cristianvega-ai" },
  { label: "x", name: "X", href: "https://x.com/cristianvega" },
  { label: "github", name: "GitHub", href: "https://github.com/cristianvega-ai" },
] as const;

/** The kind of each page. The html element names it in data-page, and the page transitions read it. */
export type PageKind = "home" | "principles" | "writing" | "article" | "products" | "product" | "lab" | "experiment" | "scene" | "error";
