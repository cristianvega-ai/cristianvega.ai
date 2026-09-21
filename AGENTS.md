# cristianvega.ai: agent instructions

This repository holds Cristian Vega's static personal site. It is built with Astro 7, TypeScript, and hand-written CSS.
Optimize for correctness, clarity, accessibility, and minimal surprise.

## Precedence

The owner's request in the conversation comes first. This file comes second.
A nested `AGENTS.md` adds rules for its own directory.
If two rules conflict, follow the more specific rule and name the conflict in your summary.

`AGENTS.md` is the canonical repository policy. `tests/AGENTS.md` and `CONTRIBUTING.md` hold detail that this file points to. A tool-specific file must point here instead of duplicating these rules.

## Language

Write everything about the work in ASD-STE100 Simplified Technical English.
This covers replies, commit messages, comments, test names, and documents, including this file.

- Keep one topic and 20 words or fewer in each sentence.
- Use the active voice.
- Give one instruction per sentence, and start it with the verb.
- Use "must" for a requirement and "can" for a possibility. Do not use "should".
- Use the same word for the same thing.

**Do not apply Simplified Technical English to what the site publishes.** Page copy, headlines, and the meta descriptions that quote them are the owner's voice. Match the voice already on the page. Keep the figurative lines, because they are deliberate: the homepage says "I build agentic AI where mistakes are expensive", and Simplified Technical English would reject that sentence.

When you edit site copy, you are writing as the owner. When you explain that edit, you are writing as an engineer.

## Commands

```bash
npm install
npm run dev
npm run verify           # the required gate: build, Astro diagnostics, and both test runners
```

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
npm run generate:touch-icon
```

## Where to look

- Use `tests/AGENTS.md` before you add, move, or change a test.
- Use `CONTRIBUTING.md` before you open a pull request.
- Use `README.md` before you change deployment, Cloudflare domain routes, or image derivatives.
- `src/styles/global.css` holds the site-wide design system and the responsive behavior.
- `src/lib/` holds the hero motion modules.
- `public/` copies into the build, including `_headers`, `_redirects`, and `robots.txt`.
- `assets/` holds build-time source files that must not copy into the static site.
- `scripts/` holds the asset-generation scripts and the post-deploy gate.
- `.github/` holds the verify-and-deploy workflow and the Dependabot policy that keeps its action pins current.

## Working rules

- Read each file before you change it, and follow the pattern already in it.
- Make the smallest change that satisfies the request. Report other problems as follow-ups.
- Prefer `rg` and `rg --files` for discovery.
- Preserve the owner's changes in a dirty worktree, and avoid unrelated cleanup.
- Make routine judgment calls yourself. Ask when two readings of a request lead to materially different work.
- Present a plan and get approval for a change that spans more than about five files, a public interface, a dependency, or a meaningful production risk.
- Run focused checks while you work, and run `npm run verify` before you finish.
- Summarize the changed files, the verification results, and the remaining risks.

### Proceed without asking

Run the build, every check, both test runners, and the local server. Edit files on a branch. Add focused tests for the requested behavior.
These actions are local and reversible.

### Ask first

- modifying or deleting existing tests;
- introducing runtime or development dependencies;
- changing public URLs, content schemas, configuration formats, or deployment behavior;
- introducing a framework, subsystem, storage layer, or architectural pattern;
- making security- or privacy-sensitive changes;
- performing broad cleanup, renames, or reorganizations primarily for style;
- using destructive Git commands or rewriting published history.

Never weaken an assertion merely to make a check pass.

## Implementation standards

- Prefer readable, explicit code over clever abstractions.
- Keep functions focused and isolate side effects.
- Reuse existing types, selectors, and design tokens.
- Validate at external boundaries and trust established internal invariants.
- Delete dead code instead of commenting it out.
- Do not add speculative extensibility or one-off utility layers.
- Do not introduce dependencies when the platform or existing stack can solve the problem cleanly.

## Frontend, accessibility, and motion

- Semantic HTML is the source of truth. Canvas and decorative layers must remain `aria-hidden` and non-interactive.
- Preserve keyboard access, visible focus states, heading hierarchy, skip navigation, link destinations, and reduced-motion behavior.
- Real content must remain visible when JavaScript, fonts, canvas, or storage fail.
- Keep animation clocks coordinated, cancel animation frames and timers during teardown, and avoid per-frame DOM measurement or allocation.
- Motion must adapt to measured layout rather than duplicating CSS breakpoints in TypeScript.
- Test changed interfaces at desktop, tablet, and mobile widths and check the browser console.

## Content and assets

- Do not publish placeholder destinations or imply that private work is publicly available.
- Commit optimized image derivatives. Production deployment is static, so the build must not depend on generating them at deploy time. That rule is about git tracking, not about the static publish set.
- Keep the portrait master out of `public/`. Files in `public/` copy into `dist/`, and the deploy uploads them.
- Run the provided scripts when the master changes, then commit the new derivatives.
- `dist/`, caches, reports, local tooling state, and internal planning artifacts must never be committed.

## Security and privacy

- Never commit credentials, tokens, local environment files, personal browser state, or private machine configuration.
- Store `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the GitHub `production` environment. Give the token only the required account access. Never write token values or private account details into tracked files, logs, or chat. Keep old host connection details private during the migration.
- Deploy only the verified build through GitHub Actions. Keep secrets out of the `Verify` job. A change to the workflow, Cloudflare policy, or domain routes needs the owner's approval.
- External links opened in a new tab must use `noopener` and `noreferrer` where appropriate.
- Preserve the production security headers and content security policy unless a reviewed deployment change requires otherwise.
- Run `npm audit` before production publication when dependencies changed.

## Git

- Stage files by explicit path. A stage-all also adds private files that `.gitignore` does not cover. Never run `git add -A` or `git add .`.
- Confirm what you staged before you write the message. `git add` fails as a whole if one path does not match. This has produced a commit that holds one file under a message that describes ten.
- The subject must describe what the commit contains. If a commit lands less than its message claims, correct it in the next commit and say so there. A message that overstates its commit misleads anyone who reads or bisects the history.
- Start the subject with the branch type and a colon, for example `fix: Retry the live gate`.
- Use `content:` for the words on the site and `documentation:` for the words about the repository.
- Keep the subject to 72 characters, including the prefix. Write it in the imperative mood and end it without a full stop.
- Wrap the body at 72 columns. Explain why the change is needed and what it affects. The diff already shows what changed.
- Keep commits atomic, reviewable, and limited to one coherent purpose.
- Prefer a fast-forward or a squash merge. When a merge commit is unavoidable, do not give it the same subject as the commit it brings in, because the two then read as a duplicate in the log.
- Do not commit `.superpowers/`, `docs/superpowers/`, local agent/editor directories, build output, caches, reports, or environment files.
- One carve-out: `.claude/skills/` holds shared project skills and is tracked. Everything else under `.claude/` stays local. Keep hostnames, accounts, paths, and any other deployment detail out of a tracked skill, because this repository is public. Those values belong in `.claude/deploy-target.local`, which stays untracked.
- Do not force-push, rewrite shared history, or bypass required checks without explicit approval.

### Branches

- Create each branch from a current `main`.
- Name the branch `<type>/<description>`, for example `fix/live-gate-retry`.
- Write the description as two to five lowercase words joined by hyphens. State the outcome.
- Keep one outcome in one branch, and delete the branch after it merges.
- A branch that a tool creates keeps the tool's name, for example `dependabot/...`.

| Type | Use it for |
| --- | --- |
| `feature` | new functionality |
| `fix` | a defect correction |
| `content` | published words that do not change behavior |
| `documentation` | words about the repository |
| `test` | test-only changes |
| `performance` | measured performance work |
| `refactor` | restructuring that preserves behavior |
| `chore` | repository or tooling maintenance |

Use the complete word. Do not use a short form such as `feat`, `docs`, or `perf`.

### Pull requests

Every change to `main` must arrive through a pull request. The repository's initial publication is the only bootstrap exception unless the owner explicitly approves another.

The `main` ruleset enforces this: it requires a pull request and a green `Verify` check, and it has no bypass. A push straight to `main` is refused.

The automated webmaster is not an exception, but it does not have to wait.
An agent that runs unattended may commit a small content or copy change to a branch, open a pull request, and enable auto-merge with `gh pr merge --auto --squash`. The pull request merges when `Verify` passes, and GitHub Actions deploys it. "Small" means words on the site and nothing else. Every other change from that agent goes to a pull request that waits for the owner. That includes code, tests, configuration, dependencies, layout, navigation, deployment behavior, and any change over about five files.

No agent deploys from a laptop in the normal path. GitHub builds the merged commit, so the live site always matches a commit on `main`. Report the merged commit hash and the workflow run. A manual GitHub workflow run must also build and verify the current `main` commit. Cloudflare domain routes live in `wrangler.jsonc`. Follow README.md before changing those routes. Enable `CLOUDFLARE_PRODUCTION_READY` only after that switch passes the live checks.

Follow `CONTRIBUTING.md` for the checklist, the title rule, and the required description.

## Done

A change is complete only when:

- the requested behavior is implemented without unrelated scope;
- relevant tests cover the behavior;
- `npm run verify` succeeds;
- affected browser flows and responsive layouts are checked;
- accessibility and reduced-motion behavior remain intact;
- Git status contains no accidental files;
- documentation reflects any changed commands, content contracts, or deployment steps.
