# cristianvega.ai: agent instructions

This repository holds Cristian Vega's static personal site. It is built with Astro 7, TypeScript, and hand-written CSS.
Optimize for correctness, clarity, accessibility, and minimal surprise.

## Precedence

The owner's request in the conversation comes first. This file comes second.
A nested `AGENTS.md` adds rules for its own directory.
If two rules conflict, follow the more specific rule and name the conflict in your summary.

`AGENTS.md` is the canonical repository policy.
`tests/AGENTS.md` holds test detail.
A tool-specific file must point here instead of duplicating these rules.

## Owner maintenance

The owner controls maintenance of this personal website.
Do not accept outside contributions.
GitHub restricts pull request creation to repository collaborators.
The owner is the only collaborator.
Keep issues, discussions, projects, and the wiki disabled.
Owner-authorized agents and Dependabot can prepare maintenance changes under the rules below.
Preserve private security reporting through `SECURITY.md`.

## Language

Use ASD-STE100 Simplified Technical English (STE) writing principles for prose about the work.
Apply these principles to replies, commit messages, comments, test descriptions, assertion messages, and documentation.
These repository rules adapt STE for software maintenance.
They do not establish full ASD-STE100 conformance.

- Keep one topic and 20 words or fewer in each sentence.
- Use the active voice.
- Give one instruction per sentence, and start it with the verb.
- Use "must" for a requirement and "can" for a possibility. Do not use "should".
- Use one precise technical term for each concept.
- Keep familiar technical terms when they name the concept accurately.
- Explain an unfamiliar technical term at first use.

Review prose and technical terms manually.
An automated check alone cannot establish ASD-STE100 conformance.
Use the [official ASD-STE100 guidance](https://www.asd-ste100.org/about_STE.html) for writing rules and technical terminology.
Read the [official STE FAQ](https://www.asd-ste100.org/STE_faq.html) for dictionary words and technical terminology.

| Prose | Example |
| --- | --- |
| Description | The font cache returns the stored width for the same font and text. |
| Assertion message | Font metrics: measuring the label must return a finite width. |
| Comment | `// The font cache must reset after the font loads.` |

**Do not apply Simplified Technical English to what the site publishes.** Page copy, headlines, and the meta descriptions that quote them are the owner's voice. Match the voice already on the page. Keep the figurative lines, because they are deliberate: the homepage says "I build agentic AI where mistakes are expensive", and Simplified Technical English would reject that sentence.

When you edit site copy, you are writing as the owner. When you explain that edit, you are writing as an engineer.

## Commands

```bash
npm install
npm run serve:development   # the Astro development server; shows drafts
npm run verify              # the required gate: build, Astro diagnostics, and both test runners
```

Useful focused commands:

```bash
npm run serve:production    # serves the current dist/ with local Wrangler, as Cloudflare does
npm run build               # checks public/ for system files, then builds dist/
npm run check               # Astro diagnostics
npm test                    # builds, then runs every Node and browser test
npm run test:unit           # fixed pure-function results; needs no build
npm run test:property       # deterministic invariants; needs no build
npm run test:integration    # builds, fixtures, scripts, and contracts; requires a current dist/
npm run test:node           # unit, property, and integration tests; requires a current dist/ and starts Wrangler
npm run test:end-to-end     # Playwright tests; requires a current dist/
npm run verify:deployment   # post-deploy: security headers on /, /writing/, and a real 404, and the old-address redirects
npm audit
npm run generate:social-preview
npm run generate:touch-icon
npm run import:lab-experiment -- <experiment> <experiment folder>   # copies a Lab experiment's scenes and cuts its clips; needs ffmpeg
```

## Where to look

- Use `tests/AGENTS.md` before you add, move, or change a test.
- Use the pull request checklist below before you open a pull request.
- Use [the deploy skill](.claude/skills/deploy/SKILL.md) for deployment, live verification, rollback, or approved account and domain setup.
- Use the [Linear website reference](https://linear.app/martinez-vega-inc/document/cristianvegaai-website-reference-90867b83f0f9) for authoring and image derivatives.
- `src/pages/` holds the routes only. Each route loads content and picks a layout.
- `src/layouts/BaseLayout.astro` is the page frame: the head, the skip link, the one reading column, and the analytics beacon. `DetailLayout.astro` adds the reading star and the title block to every page under the homepage. `ArticleLayout.astro` and `ProductLayout.astro` build on it, and their `[slug].astro` routes only load content.
- `src/components/` holds the parts, one folder for each feature:
  - `site/`: `SiteHead` and `CloudflareAnalytics`.
  - `identity/`: the homepage identity, the profile links, and `LyraMark`.
  - `navigation/`: the reading star.
  - `sections/`: the homepage sections and the entry rows that the homepage and the index pages share.
  - `lab/`: the Lab clips, cards, result tiles, prompt, and the stage and bar of a live scene.
- `src/browser/` holds the code that runs in the page.
  - `lyra-mark.js` and `page-transitions.js` are plain JavaScript. `SiteHead` loads them by address as classic scripts in the head, so they run before the first render. Keep them plain JavaScript.
  - `reading-star-progress.ts`, `article-interactions.ts`, and the Lab modules load as Astro module scripts from their components. `lab-clip-clock.ts` plays the clips on one clock, `lab-row-preview.ts` shows the homepage preview, and `scene-viewer.ts` runs the live viewer.
- `src/shared/` holds pure helpers that tests import. It has no DOM code.
  - `site.ts` holds the owner's name, job title, profile links, and page kinds.
  - `content/` holds the `writing.ts` and `products.ts` content helpers, the entry row data, and `latest-entries.ts`. The homepage shows the newest four entries of each section.
  - `lyra/` holds the star data and the geometry of the Lyra mark.
  - `lab/` holds the Lab media addresses and the clip clock.
- `src/styles/` holds one stylesheet for each component, layout, or page. Each one imports its own sheet, for example `LyraMark.astro` imports `lyra-mark.css`. `tokens.css` holds the design tokens and the fonts. `base.css` holds the base elements, the page column, the entrance, and the page transitions. `prose.css` holds the article and product prose. The class names in it are the authoring contract in `src/content/article-fixture-guide.md`.
- `src/content/` holds the Markdown for the `writing`, `products`, and `lab` collections. All three hide drafts in production.
- The Lab:
  - A Lab experiment is one prompt and its results. One result makes a single piece, and two or more make a group, one result for each model.
  - Its routes are `/lab/`, `/lab/<experiment>/`, and `/lab/<experiment>/<result>/`.
  - `assets/lab/<experiment>/` holds its `import.json` manifest, its clips, its posters, and each model's scene. They are build-time sources, and nothing there copies into the site as it is.
  - `src/integrations/lab-media.ts` serves that media in development. After a build, it copies only published experiments into `dist/lab/media/` and `dist/lab/scenes/`, so a draft never reaches the live site.
  - To add an experiment, write its manifest and run `npm run import:lab-experiment`. Then add its Markdown with `draft: true`. Publish only after the owner confirms the prompt and the model names.
  - The repository is public, so a committed draft is readable on GitHub.
- The `writing` collection publishes at `/writing/`.
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

## Naming

Code and filename conventions adapt the STE principle of consistent technical terminology.
These conventions use the syntax of each language and tool.
They do not establish ASD-STE100 conformance for code.

- Use complete, familiar words for owned paths, commands, code identifiers, style names, environment variables, and branch types.
- Name the subject and purpose. Avoid acronyms, shortened words, unexplained codes, and single-letter labels.
- Use `camelCase` for local JavaScript and TypeScript variables, parameters, fields, and imported aliases.
- Use `width` and `height` for dimensions.
- Name loop indices by their subject, such as `articleIndex` or `pathIndex`.
- Keep an already clear name unless its purpose changes.
- Keep task codes inside documents. Do not use them as opaque path names.
- Use lowercase words with hyphens for folders and ordinary files.
- Use PascalCase for component and layout filenames.
- Use `writing` for the section and collection. Use `article` for an individual piece and its helpers.
- Name test fixtures by the behavior they test.
- Name test files by their tested module or behavior.
- Name each npm script `action:object`, such as `test:unit` or `serve:production`. A name without a colon acts on the whole checkout.
- Do not use npm `pre` or `post` hooks. List every step in the command that runs it.
- Give each command one name. Do not keep a second name as an alias.
- Name each file in `scripts/` as `action-object.mjs`, such as `verify-deployment.mjs`.
- Name a workflow file after its `name` value, such as `verify-and-deploy.yml` for `Verify and deploy`.
- Name each workflow job and step with an imperative phrase and its object, such as `Package the site`.
- Name a repository variable that turns a feature on as `AREA_FEATURE_ENABLED`, such as `PRODUCTION_DEPLOY_ENABLED`.
- Use `YYYY-MM-DD` for dates in names.
- Keep `src/`, `Lyra`, official brand and font names, and ordinary mathematical coordinates.
- Preserve required tool names, filenames, file extensions, and package keys.
- Keep native interface names and required format, protocol, and schema keys, such as `og:image`.
- During naming changes, preserve production exports, selectors, URLs, and fixture content.

| Name | Example | Purpose |
| --- | --- | --- |
| Local value | `viewportWidth` | The viewport width in pixels. |
| Loop index | `articleIndex` | The current article position. |
| Test file | `label-font.test.mjs` | The label font Node suite. |

## Frontend, accessibility, and motion

- Semantic HTML is the source of truth. Canvas and decorative layers must remain `aria-hidden` and non-interactive.
- Preserve keyboard access, visible focus states, heading hierarchy, skip navigation, link destinations, and reduced-motion behavior.
- Real content must remain visible when JavaScript, fonts, or storage fail.
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
- Deploy only the verified build through GitHub Actions. Keep secrets out of the `Verify and package the site` job. A change to the workflow, Cloudflare policy, or domain routes needs the owner's approval.
- External links opened in a new tab must use `noopener` and `noreferrer` where appropriate.
- Preserve the production security headers and content security policy unless a reviewed deployment change requires otherwise.
- The Lab scenes are code that models wrote. The `/lab/scenes/*` rule in `public/_headers` gives them a sandboxed, opaque origin with their own policy. The live viewer also frames them with `sandbox`. Never loosen the site policy to make a scene work, and never serve a scene outside `/lab/scenes/`.
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
- One carve-out: `.claude/skills/` holds shared project skills and is tracked. Everything else under `.claude/` stays local. Keep private hostnames, account identifiers, machine paths, credentials, and old host details out of tracked skills. Private deployment values belong in `.claude/deploy-target.local`, which stays untracked. Read public deployment names and routes from `wrangler.jsonc`.
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

### Owner maintenance pull requests

Every change to `main` must arrive through a pull request.
The repository's initial publication is the only bootstrap exception unless the owner explicitly approves another.

The `main` ruleset requires a pull request and a green `Verify and package the site` check.
It has no bypass.
GitHub refuses a push straight to `main`.

The owner-authorized automated webmaster follows these gates.
It can commit a small content or copy change to a branch.
It can open a pull request and enable auto-merge with `gh pr merge --auto --squash`.
The pull request merges when `Verify and package the site` passes, and GitHub Actions deploys it.
"Small" means words on the site and nothing else.
Every other change from that agent requires a pull request that waits for the owner.
This includes code, tests, configuration, dependencies, layout, navigation, deployment behavior, and any change over about five files.

No agent deploys from a laptop in the normal path.
GitHub builds the merged commit, so the live site always matches a commit on `main`.
Report the merged commit hash and the workflow run.
A manual GitHub workflow run must also build and verify the current `main` commit.
Cloudflare domain routes live in `wrangler.jsonc`.
Follow [the deploy skill's domain procedures](.claude/skills/deploy/references/domain-setup.md) before changing those routes.
Enable `PRODUCTION_DOMAIN_CHECK_ENABLED` only after that switch passes the live checks.

#### Before you open a pull request

1. Rebase or merge the current `main` into the branch.
   Resolve conflicts locally.
2. Review the complete diff for unrelated files, generated noise, secrets, and temporary tooling artifacts.
3. Run `npm run verify`.
4. Run `npm audit` when dependency files changed.
5. Browser-test affected routes and interactions.
   Include desktop and mobile evidence for visual changes.

#### Title and description

Use the same complete-word prefixes for pull request titles and commits.
Keep each pull request focused on one outcome.

Include these items in every pull request description:

- **Summary:** what changed and why;
- **Changes:** the important implementation details;
- **Verification:** exact commands and browser scenarios run;
- **Visual evidence:** before/after screenshots or video for interface changes, or `Not applicable`;
- **Risk and rollback:** likely failure modes and how to revert safely;
- **Related work:** linked prior work when applicable.

#### Review and merge

Use a draft pull request while behavior or verification is incomplete.
Complete the description, pass checks, and remove temporary debugging code before you mark it ready.
Keep the branch reviewable commit by commit.
Resolve every review thread explicitly.
Prefer a squash merge when branch history is exploratory.
Preserve multiple commits only when they form an intentional, independently understandable sequence.

## Done

A change is complete only when:

- the requested behavior is implemented without unrelated scope;
- relevant tests cover the behavior;
- `npm run verify` succeeds;
- affected browser flows and responsive layouts are checked;
- accessibility and reduced-motion behavior remain intact;
- Git status contains no accidental files;
- documentation reflects any changed commands, content contracts, or deployment steps.
