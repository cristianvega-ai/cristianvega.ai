# Article visual fixture

Use the [full article](writing/full-article-layout-fixture.md) as the maintained visual fixture for article pages.
It demonstrates prose, section spacing, lists, inline code, highlighted code, diagrams, quotes, and series metadata.
The seven short draft articles support index, ordering, and adjacent-article review.

This guide sits outside the collection loader directories in [content.config.ts](../content.config.ts).
It defines no writing entry and no public route.
Keep it outside `src/content/writing/` and `src/content/products/`.

## Ownership

Cristian Vega owns the fixture content and publication decisions.
The maintainer who changes article presentation owns fixture maintenance and the related browser checks.

| File | Responsibility |
| --- | --- |
| [Fixture Markdown](writing/full-article-layout-fixture.md) | Owns content, code text, SVG geometry, captions, and accessibility semantics. |
| [ArticleLayout.astro](../layouts/ArticleLayout.astro) | Owns the article shell, metadata, draft label, sharing controls, and adjacent navigation. |
| [writing.css](../styles/writing.css) | Owns article appearance, code colors, diagram styles, panel scrolling, and visible focus. |
| [article-interactions.ts](../shared/article-interactions.ts) | Adds missing accessibility defaults and controls the copy-link action. |

Keep the fixture representative when these files change.
Preserve the owner's prose unless the owner requests a content change.

## Draft and publication rules

Keep all eight article fixtures unpublished.
Keep the full fixture's `draft: true` value.
Use `npm run dev` to preview `/writing/full-article-layout-fixture/`.
The preview shows `Draft preview · not published` and requests `noindex, follow`.
Production excludes drafts from article routes, navigation, and the sitemap.
Production creates the Writing index only when at least one published article exists.
Keep this fixture excluded when real articles become public.

Use `createContentBuild` in [tests/helpers.mjs](../../tests/helpers.mjs) for publication test fixtures.
The helper replaces content only in temporary project copies.
All-draft and mixed test fixtures cover publication without changing source content.
Do not publish this visual fixture to test published behavior.

## Representative structures

Keep the following structures in the full fixture.
They exercise the current article styles and browser behavior.

| Structure | Authored markup | Purpose |
| --- | --- | --- |
| Sections | `p.section-heading-number[aria-hidden="true"]` followed by Markdown headings | Exercises decorative numbering and heading spacing. |
| Principles | `ul.principles > li` | Exercises a styled list with semantic list items. |
| Diagram | `figure.figure`, `.figure__panel`, `svg.pipeline`, and `figcaption` | Exercises a scrolling SVG panel and its caption. |
| Code | `figure.code`, `figcaption`, `pre > code`, and `syntax-*` spans | Exercises file and language captions, preserved whitespace, wide lines, and code colors. |
| Inline code | `code` within prose | Exercises inline code spacing and type. |
| Quote | `blockquote.pull`, `p`, and `cite` | Exercises quote type and attribution. |

The diagram contains a branch, gate, model nodes, ordinary nodes, and a legend.
The SVG keeps its `viewBox`, `pipeline-*` classes, and authored text.
The code uses `syntax-keyword`, `syntax-string`, `syntax-number`, and `syntax-comment` spans.
Keep code colors in external CSS.
The build disables automatic syntax highlighting.

## Accessibility semantics

Content owns the meaning of each code region and diagram.
Write a descriptive `aria-label` or `aria-labelledby` when a region needs a specific accessible name.
Keep figure captions with their code or diagram.
Keep the SVG's `role="img"` and descriptive accessible name in the authored markup.
Keep authored `aria-label`, `aria-labelledby`, `role`, and `tabindex` attributes.

`setupArticle()` supplies missing attributes on `.prose pre` and `.figure__panel` inside `.article`.
Its defaults are `role="region"`, `tabindex="0"`, `Code example` for code, and `Diagram` for diagrams.
It adds a default name only when both `aria-label` and `aria-labelledby` are absent.
It preserves authored names, roles, and focus order.
Keep keyboard scrolling and visible focus on wide code and diagram panels.
Keep the fixture readable without JavaScript.

## Maintenance and shared components

Use [writing.spec.mjs](../../tests/browser/writing.spec.mjs) for article layout, keyboard scrolling, draft exclusion, and JavaScript failure checks.
Use [article-interactions.spec.mjs](../../tests/browser/article-interactions.spec.mjs) for authored semantics and missing defaults.
Use [article-menu.spec.mjs](../../tests/browser/article-menu.spec.mjs) for article text and menu contrast.
Review desktop, tablet, and mobile widths after presentation changes.
Check the browser console.
Update the related assertions when an approved presentation contract changes.

Keep the full fixture's code and diagram markup as the current reference.
Do not extract shared components from this single fixture.
Extract a shared component only when at least two real articles repeat the same structure and behavior.
Use those articles to define the required inputs, captions, accessible names, and focus behavior.
Keep article-specific SVG geometry and text with the article.
Preserve each article's authored semantics through component properties.
Keep this fixture as a regression case after extraction.
