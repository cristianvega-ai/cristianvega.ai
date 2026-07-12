# Repository Instructions

This repository contains Cristian Vega's static personal site. It is built with Astro 7, TypeScript, content collections, and hand-written CSS. Optimize for correctness, clarity, accessibility, and minimal surprise.

## Ground Truth First

- Read the relevant files before proposing or making changes.
- Prefer `rg` and `rg --files` for discovery.
- Follow existing patterns unless a change explicitly requires a new one.
- Preserve user changes in a dirty worktree and avoid unrelated cleanup.
- Treat `AGENTS.md` as the canonical repository policy. Tool-specific instruction files must point here instead of duplicating these rules.

## Project Map

- `src/pages/`: Astro routes, including the homepage, portfolio pages, posts, RSS, and the custom 404 page.
- `src/components/`: reusable presentation and motion components.
- `src/layouts/`: shared document, navigation, metadata, and article layouts.
- `src/content/`: Markdown posts validated by `src/content.config.ts`.
- `src/lib/`: typed content and project helpers.
- `src/styles/global.css`: the site-wide design system and responsive behavior.
- `public/`: static production assets copied into the build, including `.htaccess` and `robots.txt`.
- `scripts/`: deterministic asset-generation scripts.
- `tests/`: Node-based build and source-contract tests.

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
npm test
npm audit
npm run generate:halftone
npm run generate:portrait
```

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
- Generated halftone data and optimized portrait derivatives are intentionally committed because production deployment is static and deterministic.
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
  - `test:` for test-only changes;
  - `documentation:` for documentation-only changes;
  - `performance:` for measured performance work;
  - `refactor:` for behavior-preserving restructuring;
  - `chore:` for repository or tooling maintenance.
- Do not use abbreviated prefixes such as `feat:`, `docs:`, or `perf:`.
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
