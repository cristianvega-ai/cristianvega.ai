export type ProjectStatus = "live" | "beta" | "wip";

export interface ProjectLink {
  label: string;
  href: string;
  kind?: "read";
  /** Open in a new tab (external demos, repos). */
  external?: boolean;
}

export interface Project {
  name: string;
  initials: string;
  blurb: string;
  status: ProjectStatus;
  tags: string[];
  /** Real destinations only — never generic archive links as stand-ins. */
  links: ProjectLink[];
  /**
   * When there is no public demo or case study yet, say so explicitly
   * instead of linking somewhere unrelated or omitting the footer.
   */
  availability?: string;
}

export const projects: Project[] = [
  {
    name: "DocSieve",
    initials: "DS",
    blurb:
      "Drag-and-drop document extraction for small insurance shops — upload a PDF, get structured JSON back.",
    status: "live",
    tags: ["Next.js", "FastAPI", "LLM"],
    links: [],
    availability: "Private demo — case study soon",
  },
  {
    name: "PromptRunner",
    initials: "PR",
    blurb:
      "A side-by-side playground for testing multi-model prompt pipelines and comparing cost against accuracy.",
    status: "beta",
    tags: ["React", "Python"],
    links: [],
    availability: "Beta — not public yet",
  },
  {
    name: "Ledgerbot",
    initials: "LB",
    blurb:
      "An agentic bookkeeping assistant that reconciles statements and flags anomalies for human review.",
    status: "wip",
    tags: ["Agents", "Postgres"],
    links: [],
    availability: "In progress — no public write-up yet",
  },
];
