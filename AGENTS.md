# Repository Instructions

This repository contains Cristian Vega's static personal site. It is built with Astro 7, TypeScript, content collections, and hand-written CSS. Optimize for correctness, clarity, accessibility, and minimal surprise.

## Language

Two registers apply here. Choose the one that matches what you are writing.

**Use ASD-STE100 Simplified Technical English for everything written about the
work.** This covers replies to the owner, commit subjects and bodies, code
comments, test names, and the documentation in this repository, including this
file and the README. Write short sentences. Use active voice. Give one idea per
sentence. Choose the plain word over the long one.

**Do not apply Simplified Technical English to what the site publishes.** Page
copy, headlines, posts in `src/content/`, project descriptions in
`src/lib/projects.ts`, and the meta descriptions that quote them are the owner's
voice. Match the voice already on the page. Keep the figurative lines, because
they are deliberate: the homepage says "I build agentic AI where mistakes are
expensive", and Simplified Technical English would reject that sentence.

When you edit site copy, you are writing as the owner. When you explain that
edit, you are writing as an engineer.

## Ground Truth First

- Read the relevant files before proposing or making changes.
- Prefer `rg` and `rg --files` for discovery.
- Follow existing patterns unless a change explicitly requires a new one.
- Preserve user changes in a dirty worktree and avoid unrelated cleanup.
- Treat `AGENTS.md` as the canonical repository policy. Tool-specific instruction files must point here instead of duplicating these rules.

## Project Map

- `src/pages/`: Astro routes, including the homepage, portfolio pages, posts, and the custom 404 page.
- `src/components/`: reusable presentation and motion components.
- `src/layouts/`: shared document, navigation, metadata, and article layouts.
- `src/content/`: Markdown posts validated by `src/content.config.ts`.
- `src/lib/`: typed content and project helpers.
- `src/styles/global.css`: the site-wide design system and responsive behavior.
- `public/`: static production assets copied into the build, including `.htaccess` and `robots.txt`.
- `scripts/`: deterministic asset-generation scripts.
- `tests/`: Node contract tests, one file per concern.
- `tests/e2e/`: Playwright specs for computed layout and runtime behavior.

## Commands

```bash
npm install
npm run dev
npm run verify
```

`npm run verify` is the required local gate. It builds the static site, runs Astro diagnostics, and executes the test suite.

Useful focused commands:

```bash
npm run build
npm run check
npm test                 # builds, then runs tests (use this or verify — not bare node --test)
npm run test:run         # Node tests only; requires a current dist/
npm run test:e2e         # browser tests only; requires a current dist/
npm run verify:deploy    # post-deploy: live security headers + real 404
npm audit
npm run generate:portrait
```

## Testing Strategy

The suite has two runners and one file per concern. Put each new test in the layer that can observe the behavior. Do not add tests to whichever file is largest.

| Layer | File | Owns |
| --- | --- | --- |
| Unit | `tests/lib.test.mjs` | Pure helpers in `src/lib/`. No DOM, no build output. |
| Build | `tests/build.test.mjs` | The build emits every expected route, asset, feed, and sitemap entry. |
| Pages | `tests/pages.test.mjs` | Rendered HTML content, headings, metadata, and navigation state. |
| Security | `tests/security.test.mjs` | `.htaccess` rules, the CSP, response headers, and the post-deploy gate. |
| Design docs | `tests/design-docs.test.mjs` | `reference.html`, `spec-template.html`, and design-token hygiene. |
| CSS | `tests/motion-css.test.mjs` | Rules that must survive compilation, such as the reduced-motion contract. |
| Behavior | `tests/e2e/*.spec.mjs` | Computed layout, sticky and responsive rules, focus, and runtime JavaScript. |

To choose a layer, ask what the test must look at:

1. A pure function — use the unit layer.
2. A string that must appear in `dist/` — use the matching contract layer.
3. Anything a browser must compute or execute — use the browser layer.

### Rules

- Do not assert on `.astro` or `.ts` source text. A regular expression over source proves only that the code looks correct. It passes when the behavior is broken, and it fails after a safe rename. If a guarantee needs the browser, write a browser spec instead.
- Node tests end in `.test.mjs`. Browser specs end in `.spec.mjs`. The `tests/*.test.mjs` glob is not recursive, which is what keeps the two runners apart. Never name a browser spec `.test.mjs`, and never put a Node test in `tests/e2e/`.
- Share browser helpers through `tests/e2e/fixtures.mjs` and Node helpers through `tests/helpers.mjs`. Do not copy a helper into a second file.
- Browser specs must be deterministic. Use Playwright's auto-waiting or `expect.poll`. Never use a fixed sleep.
- Wait for the page entrance animation before you measure geometry. Use `settle(page)` from the fixtures. Geometry read during the animation is the animation's, not the layout's.
- Prove a new assertion can fail. Break the behavior, watch the test fail, then restore it. An assertion that never fails is not coverage.
- `npm run verify` runs both runners. The browser layer needs Chromium. Run `npx playwright install chromium` once per machine.

## Working Workflow

1. Discover the relevant code paths and current conventions.
2. Clarify ambiguous behavior before implementation.
3. For changes spanning more than roughly five files, public interfaces, dependencies, or meaningful production risk, present a plan and obtain approval.
4. Make the smallest coherent change that satisfies the request.
5. Run focused checks while working and `npm run verify` before completion.
6. Summarize changed files, verification results, and remaining risks.

## Stop and Ask

Obtain explicit approval before:

- modifying or deleting existing tests;
- introducing runtime or development dependencies;
- changing public URLs, content schemas, configuration formats, or deployment behavior;
- introducing a framework, subsystem, storage layer, or architectural pattern;
- making security- or privacy-sensitive changes;
- performing broad cleanup, renames, or reorganizations primarily for style;
- using destructive Git commands or rewriting published history.

Adding focused tests for requested behavior does not require separate approval. Never weaken an assertion merely to make a check pass.

## Implementation Standards

- Prefer readable, explicit code over clever abstractions.
- Keep functions focused and isolate side effects.
- Reuse existing types, selectors, and design tokens.
- Validate at external boundaries and trust established internal invariants.
- Delete dead code instead of commenting it out.
- Do not add speculative extensibility or one-off utility layers.
- Do not introduce dependencies when the platform or existing stack can solve the problem cleanly.

## Frontend, Accessibility, and Motion

- Semantic HTML is the source of truth. Canvas and decorative layers must remain `aria-hidden` and non-interactive.
- Preserve keyboard access, visible focus states, heading hierarchy, skip navigation, link destinations, and reduced-motion behavior.
- Real content must remain visible when JavaScript, fonts, canvas, or storage fail.
- Keep animation clocks coordinated, cancel animation frames and timers during teardown, and avoid per-frame DOM measurement or allocation.
- Motion must adapt to measured layout rather than duplicating CSS breakpoints in TypeScript.
- Test changed interfaces at desktop, tablet, and mobile widths and check the browser console.

## Content and Assets

- Do not publish placeholder destinations or imply that private work is publicly available.
- Keep post frontmatter aligned with `src/content.config.ts`.
- Optimized portrait derivatives are intentionally committed because production deployment is static and deterministic.
- Regenerate tracked derivatives with the provided scripts when their source changes.
- `dist/`, caches, reports, local tooling state, and internal planning artifacts must never be committed.

## Security and Privacy

- Never commit credentials, tokens, local environment files, personal browser state, or private machine configuration.
- External links opened in a new tab must use `noopener` and `noreferrer` where appropriate.
- Preserve the production security headers and content security policy unless a reviewed deployment change requires otherwise.
- Run `npm audit` before production publication when dependencies changed.

## Git Hygiene

- Create focused branches using `feature/<description>`, `fix/<description>`, `documentation/<description>`, `test/<description>`, or `chore/<description>`.
- Keep commits atomic, reviewable, and limited to one coherent purpose.
- Use imperative commit subjects with complete-word prefixes:
  - `feature:` for user-facing functionality;
  - `fix:` for defect corrections;
  - `content:` for site copy and published content that does not change behavior;
  - `test:` for test-only changes;
  - `documentation:` for repository documentation, such as this file or the README;
  - `performance:` for measured performance work;
  - `refactor:` for behavior-preserving restructuring;
  - `chore:` for repository or tooling maintenance.
- Do not use abbreviated prefixes such as `feat:`, `docs:`, or `perf:`.
- Use `content:` for the words on the site and `documentation:` for the words about the repository.
- Keep the subject to 72 characters, including the prefix. Write it in the
  imperative mood and end it without a full stop.
- The subject must describe what the commit contains. If a commit lands less
  than its message claims, correct it in the next commit and say so there. A
  message that overstates its commit is worse than no message, because it
  misleads anyone who reads or bisects the history.
- Wrap the body at 72 columns. Explain why the change is needed and what it
  affects. The diff already shows what changed.
- Prefer a fast-forward or a squash merge. When a merge commit is unavoidable,
  do not give it the same subject as the commit it brings in, because the two
  then read as a duplicate in the log.
- Do not commit `.superpowers/`, `docs/superpowers/`, local agent/editor directories, build output, caches, reports, or environment files.
- Do not force-push, rewrite shared history, or bypass required checks without explicit approval.

## Pull Requests

All future changes to `main` should arrive through a pull request. The repository's initial publication is the only bootstrap exception unless the owner explicitly approves another.

Before opening a pull request:

1. Rebase or merge the current `main` into the branch and resolve conflicts locally.
2. Review the complete diff for unrelated files, generated noise, secrets, and temporary tooling artifacts.
3. Run `npm run verify`.
4. Run `npm audit` when dependency files changed.
5. Browser-test affected routes and interactions. Include desktop and mobile evidence for visual changes.

Pull request titles must use the same complete-word prefixes as commits. Keep each pull request focused on one outcome.

Every pull request description must include:

- **Summary:** what changed and why;
- **Changes:** the important implementation details;
- **Verification:** exact commands and browser scenarios run;
- **Visual evidence:** before/after screenshots or video for interface changes, or `Not applicable`;
- **Risk and rollback:** likely failure modes and how to revert safely;
- **Related work:** linked issue, discussion, or prior pull request when applicable.

Use a draft pull request while behavior or verification is incomplete. Mark it ready only when the description is complete, checks pass, temporary debugging code is removed, and the branch is reviewable commit by commit.

Resolve every review thread explicitly. Prefer a squash merge when branch history is exploratory; preserve multiple commits only when they form an intentional, independently understandable sequence.

## Definition of Done

A change is complete only when:

- the requested behavior is implemented without unrelated scope;
- relevant tests cover the behavior;
- `npm run verify` succeeds;
- affected browser flows and responsive layouts are checked;
- accessibility and reduced-motion behavior remain intact;
- Git status contains no accidental files;
- documentation reflects any changed commands, content contracts, or deployment steps.
