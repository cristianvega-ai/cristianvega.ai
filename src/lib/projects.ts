type ProjectStatus = "live" | "beta" | "wip";

export interface Project {
  name: string;
  initials: string;
  blurb: string;
  status: ProjectStatus;
  tags: string[];
  /** Public destination, for the projects that have one. */
  href?: string;
  /**
   * Projects without a public destination state availability in words instead
   * of linking somewhere unrelated.
   */
  availability?: string;
}

export const projects: Project[] = [
  {
    name: "OpenCatalyst",
    initials: "OC",
    blurb:
      "A local-first agentic AI desktop app: a Rust engine, multi-provider model routing, and a multi-agent mode where models draft, judge, and verify each other's work.",
    status: "live",
    tags: ["Rust", "TypeScript", "Agents"],
    href: "https://opencatalyst.ai/",
    availability: "Live at opencatalyst.ai",
  },
  {
    name: "DocSieve",
    initials: "DS",
    blurb:
      "Drag-and-drop document extraction for small insurance shops: upload a PDF, get structured JSON back.",
    status: "live",
    tags: ["Next.js", "FastAPI", "LLM"],
    availability: "Private demo, case study soon",
  },
  {
    name: "PromptRunner",
    initials: "PR",
    blurb:
      "A side-by-side playground for testing multi-model prompt pipelines and comparing cost against accuracy.",
    status: "beta",
    tags: ["React", "Python"],
    availability: "Beta, not public yet",
  },
  {
    name: "Ledgerbot",
    initials: "LB",
    blurb:
      "An agentic bookkeeping assistant that reconciles statements and flags anomalies for human review.",
    status: "wip",
    tags: ["Agents", "Postgres"],
    availability: "In progress, no public write-up yet",
  },
];
