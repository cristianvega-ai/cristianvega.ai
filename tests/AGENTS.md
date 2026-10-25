# cristianvega.ai tests: agent instructions

These rules add to the root `AGENTS.md`. Read them before you add, move, or change a test.

## Language and naming

Use the root `AGENTS.md` for general language and naming rules.
Apply its STE writing principles to test descriptions, assertion messages, and comments.
Treat code and filename naming as a repository adaptation of STE technical terminology.

- State the subject, condition, and expected behavior in each test description.
- Keep assertion messages useful when the test fails.
- Name each Node test file by its tested module or behavior.
- Name each browser file `<subject>-<behavior>.spec.mjs`. The subject is a page, a component, or the runtime.
- Give each browser file one behavior. Do not split shared setup into one file for each test.
- Keep `.test.mjs` for Node suites and `.spec.mjs` for browser suites.
- Preserve clear names, assertion inputs, case counts, and cleanup behavior during naming changes.
- Preserve the native and production names listed in root `AGENTS.md`.

| Item | Example |
| --- | --- |
| Description | The reading star lights Vega when the page scrolls to its end. |
| Assertion message | Reading star: Vega must light at the end of the page. |
| Local identifier | `viewportWidth` or `articleIndex` |
| Node filename | `lyra-mark-geometry.test.mjs` |
| Browser filename | `writing-navigation.spec.mjs` |
| Comment | `// The entrance animation must finish before geometry measurements.` |

Use one term for each test concept.
These terms adapt the [official STE terminology guidance](https://www.asd-ste100.org/about_STE.html) to this suite.

| Term | Meaning |
| --- | --- |
| Fixture | Test data or setup that supplies a controlled test state. |
| Viewport | The browser area that displays the page. |
| Route | A path that the website serves. |
| Interpolate | Calculate a value between supplied values. |
| Assertion | A check that compares an observed result with an expected result. |

Use one behavior word for each shared browser concern.
Use a word from this table when it matches the concern.
Name a concern that only one subject has directly, for example `reading-progress`, `sky-angle`, or `title-name`.

| Behavior | Meaning |
| --- | --- |
| `layout` | Readable content and geometry at each tested viewport. |
| `navigation` | Links, routes, and draft visibility. |
| `keyboard` | Keyboard focus, focus rings, and keyboard scrolling. |
| `motion` | Frames, entrances, and motion preferences. |
| `lifecycle` | Teardown on pagehide and restoration on pageshow. |
| `fallbacks` | Readable content when JavaScript, fonts, storage, or the Navigation API fail. |

## Testing strategy

The suite has two runners and four test types.
Each suite owns one concern.
Put checks in the type that observes the failure.

| Type | Folder | Owns |
| --- | --- | --- |
| Unit | `tests/unit/` | Specific pure-function results, including fixed example tables. |
| Property | `tests/property/` | Deterministic invariants over samples, ranges, generated structures, and data collections. |
| Integration | `tests/integration/` | Builds, fixtures, scripts, and repository contracts. |
| End-to-end | `tests/end-to-end/` | Layout and behavior that Playwright observes in a browser or local runtime. |
| Shared | `tests/shared/` | Shared Node helpers, browser fixtures, and development-server configuration. |

Unit and property suites read pure helpers.
They do not read the DOM or build output.
Keep fixed examples in unit suites, even when one case uses a table.
Keep deterministic input ranges in property suites.
Split a mixed suite when its cases need different types.

## Node ownership

| Type | File | Owns |
| --- | --- | --- |
| Unit | `tests/unit/latest-entries.test.mjs` | The four newest entries of a collection, newest first, with date ties broken by id. |
| Unit | `tests/unit/lab-media-paths.test.mjs` | The Lab experiment, result, scene, and clip addresses, and the rejected reserved slugs `media` and `scenes`. |
| Property | `tests/property/lyra-mark-geometry.test.mjs` | Valid star indices, links between stars, and the padded Lyra mark extent. |
| Integration | `tests/integration/build.test.mjs` | Static file safety, sitemap completeness, the `/about/` redirect and absent route, the four IBM Plex font faces, and private image exclusions. Lab clips and posters pass only under `/lab/media/`. Scene files skip the path-length and sitemap equality checks and keep every other check. |
| Integration | `tests/integration/pages.test.mjs` | The home identity, bio, and profile links, the missing page frame, landmarks, metadata, head scripts, and safe outbound links. |
| Integration | `tests/integration/publication.test.mjs` | Production routes, draft privacy, homepage sections with their newest four rows and index links, detail frames, content order, and escaped metadata. Lab routes, media, scenes, and pages exist for a published experiment only. A draft leaves nothing in `dist/lab/`. The build stops for a reserved or repeated slug. |
| Integration | `tests/integration/check-public-system-files.test.mjs` | The build check keeps operating-system files out of public assets. |
| Integration | `tests/integration/security.test.mjs` | Cloudflare header and cache rules, the CSP of the `/*` block, the Lab rule order, the scene sandbox block, the inline code scan that exempts only the folders of the scene rule, and `security.txt`. |
| Integration | `tests/integration/deployment-gate.test.mjs` | Verified build acceptance, representative broken responses, the `/about/` redirect, unsafe script URLs, approved headers, the local Cloudflare build, and the Lab walk: skipped on 404, and on 200 the scene sandbox headers, with a local Cloudflare build that publishes the Lab. |
| Integration | `tests/integration/deployment-workflow.test.mjs` | Parsed workflow triggers, action pins, token scope, secrets, freshness conditions, and artifact integrity. |
| Integration | `tests/integration/node-version.test.mjs` | Exact .nvmrc format and the actual test runtime. |
| Integration | `tests/integration/motion-styles.test.mjs` | The reduced motion reset, the page transition switch, and the entrance preference in compiled CSS. |

## Focused commands

```bash
npm run test:unit
npm run test:property
npm run test:integration
npm run test:end-to-end
```

Unit and property commands need no build.
Integration and end-to-end commands need a current `dist/`.
The deployment integration suite starts Wrangler on `dist/`.
`npm run test:node` runs all three Node types through explicit globs.
`npm test` builds, then runs the Node and browser tests.
`npm run verify` builds, checks Astro diagnostics, and runs both runners.

## End-to-end ownership

| File | Owns |
| --- | --- |
| `tests/end-to-end/home-layout.spec.mjs` | The identity, bio, profiles, and the Products, Lab, and Writing sections in order, with at most four rows each, at 1440, 900, and 390 pixels. |
| `tests/end-to-end/home-row-preview.spec.mjs` | The Lab row preview that shows for a fine pointer with allowed motion and stays away for reduced motion, touch, and other rows. |
| `tests/end-to-end/home-keyboard.spec.mjs` | The skip link, the tab order through the profiles, rows, and index links, and their focus rings. |
| `tests/end-to-end/home-navigation.spec.mjs` | Sections and index links for published content only, row and index navigation, and profile links. |
| `tests/end-to-end/home-motion.spec.mjs` | The mark entrance that ends ready, and the skipped mark and text entrances under reduced motion. |
| `tests/end-to-end/home-sky-angle.spec.mjs` | The `--sky-angle` value at the transit of Vega and three hours either side, set before the body renders. |
| `tests/end-to-end/page-transitions-title-name.spec.mjs` | Exactly one element holds the view transition name `title` after a click on a home row or a More writing row. |
| `tests/end-to-end/reading-star-layout.spec.mjs` | The star level with the title in the margin from 900 pixels, pinned on scroll, and a bottom pill below 900 pixels. |
| `tests/end-to-end/reading-star-navigation.spec.mjs` | The parent link, the history return with its scroll position, the Home label, new-tab clicks, and Escape. |
| `tests/end-to-end/reading-star-reading-progress.spec.mjs` | Figure lines that draw with scroll, Vega at the end of the page, and a complete star on a short page. |
| `tests/end-to-end/reading-star-lifecycle.spec.mjs` | Listeners and frames that stop on pagehide and return on pageshow from the cache. |
| `tests/end-to-end/writing-navigation.spec.mjs` | Article navigation from the home page and the list, year groups, More writing neighbours, Enter, and draft privacy. |
| `tests/end-to-end/article-keyboard.spec.mjs` | Keyboard scrolling and focus rings on wide code and diagrams, the star in the tab order, and a pill that leaves the last control uncovered. |
| `tests/end-to-end/article-interactions.spec.mjs` | Article code and diagram names, roles, focus order, and the scope of the article setup. |
| `tests/end-to-end/products-navigation.spec.mjs` | Product list and detail navigation, newest first, responsive reading, and production draft privacy. |
| `tests/end-to-end/missing-page-navigation.spec.mjs` | Real 404 status, the home page link in the lede, and the star back home. |
| `tests/end-to-end/page-fallbacks.spec.mjs` | Readable home, article, and missing pages without JavaScript, and navigation when fonts, storage, or the Navigation API fail. |
| `tests/end-to-end/publication.spec.mjs` | Published content in an isolated production build: routes, sitemap, robots, navigation, scripts, and the copy link. |
| `tests/end-to-end/hosting.spec.mjs` | Local Cloudflare headers, redirects including `/about/`, preview indexing, compression, caching, security contact, and refused requests. The `/lab/*` headers, the media cache, the scene sandbox headers on every scene file, and missing Lab paths. |
| `tests/end-to-end/security.spec.mjs` | The browser enforces the CSP and the permissions policy. |
| `tests/end-to-end/analytics.spec.mjs` | The Cloudflare beacon loads on the production origin only, and pages work when it is blocked. |
| `tests/end-to-end/lab-navigation.spec.mjs` | The grid, experiment, and scene pages, the way back, arrows that replace history, arrow keys, Escape, the homepage Lab section, and draft privacy. |
| `tests/end-to-end/lab-transitions.spec.mjs` | The transition names on a clicked clip and card, the stored arrow direction, and the scroll to the returning clip. |
| `tests/end-to-end/lab-motion.spec.mjs` | Clips that start together, play while one clip is on screen and pause together when none is, stay within 0.25 seconds of each other, stop with the pause control, and hold posters under reduced motion. |
| `tests/end-to-end/lab-lifecycle.spec.mjs` | Clips that pause on pagehide, stay paused, and play again on a pageshow from the cache. |
| `tests/end-to-end/lab-fallbacks.spec.mjs` | Readable Lab pages without JavaScript, posters when playback is refused, and the full screen button gate. |
| `tests/end-to-end/scene-isolation.spec.mjs` | The scene frame origin `null`, storage and document that the scene cannot read, the page that keeps the site CSP, and framing limits. |
| `tests/end-to-end/scene-loading.spec.mjs` | Every scene file loads from an opaque origin under the scene policy with no violation. |

Keep page selectors and expectations in their owning suite.
Share identical navigation, settlement, and frame mechanisms through `tests/shared/browser-fixtures.mjs`.

To choose a layer, ask what the test must look at:

1. A specific pure-function result — use the unit type.
2. A deterministic invariant across inputs or generated structures — use the property type.
3. A build, fixture, script, or repository contract — use the integration type.
4. Anything a browser must compute or execute — use the end-to-end type.

## Test value

Keep cases that protect important behavior or credible faults.
A distinct cosmetic difference alone does not justify a case.
Do not use case counts as coverage targets.

- Name the important failure each case detects.
- Check existing coverage before adding a case.
- Do not add import-only or export-existence cases.
- Keep each suite proportional to current website behavior.
- Prefer cheap unit checks for stable shared boundaries.
- Merge cases that repeat setup and detect the same failure.
- Keep essential assertions and useful failure messages when moving coverage.
- Record deliberate removals and their maintenance value.
- Keep checks across layers when they detect different failures.
- Select representative security, route, data, and responsive inputs from different failure mechanisms.
- Cover each critical boundary before adding syntax or position permutations.
- Use the smallest matrix that exposes those boundaries.
- Record the reason for each matrix dimension near its definition.
- Avoid full Cartesian products unless their combinations expose important faults.
- Keep basic draft navigation, implemented interactions, and production privacy.
- Require an explicit owner requirement before adding exhaustive checks for draft visuals.
- Share each isolated build when its fixture and production inputs match.
- Keep route and rendered publication assertions together in `tests/integration/publication.test.mjs`.
- Use physical bounds for geometry. Use exact decorative values only for an explicit owner requirement.
- Keep owner branding fixed.
- Compare changing profile text with rendered metadata.
- Require nonempty inputs before looping over expected elements.
- Include the subject, input, and expected result in failure messages.
- Preserve security, draft privacy, keyboard access, motion preferences, fallbacks, and resource cleanup.

## Rules

- Apply the naming rules to local test variables, parameters, object fields, and imported aliases.
- Do not assert on `.astro` or `.ts` source text. A regular expression over source proves only that the code looks correct. It passes when the behavior is broken, and it fails after a safe rename. If a guarantee needs the browser, write a browser spec instead.
- Node tests end in `.test.mjs` and belong in unit, property, or integration folders.
- End-to-end specs end in `.spec.mjs` and belong in `tests/end-to-end/`.
- Use explicit Node globs for those three folders.
- Configure Playwright to discover only `tests/end-to-end/*.spec.mjs`.
- Keep shared files outside both runners' discovery patterns.
- Share browser helpers through `tests/shared/browser-fixtures.mjs` and Node helpers through `tests/shared/node-helpers.mjs`.
- Do not copy a helper into a second file.
- Build changed source or content with `createIsolatedBuild` or `createContentBuild` from `tests/shared/node-helpers.mjs`.
- Do not change the source of the repository in a test.
- Browser specs must be deterministic. Use Playwright's auto-waiting or `expect.poll`. Never use a fixed sleep.
- Wait for the page entrance animation before you measure geometry. Use `settle(page)` from the fixtures. Geometry read during the animation is the animation's, not the layout's.
- A page transition can make the page ignore clicks in headless Chromium. Set reduced motion in a context without JavaScript when a test clicks twice in a row.
- The site scrolls smoothly. Scroll with `behavior: "instant"` before you measure, or poll for the scroll result.
- A test must pass with drafts and with published entries. Derive expected content from `tests/shared/node-helpers.mjs`, including `publishedContent`, `homeSections`, and `profileLinks`.
- The Lab experiment `floating-castles` stays a draft in the repository. Test a published Lab in an isolated build: pass `lab: { state: "published" }` to `createContentBuild`, and use the `labTest` fixture for the browser. The build links the real `assets/` folder.
- A scene is a real-time 3D app that keeps the processor busy and starves the page. Replace its page with `stubSceneBodies(page)`, which keeps the real response headers. Run a real scene only when the test needs its code.
- A scene reads `window.origin`, not `location.origin`. `location.origin` ignores the sandbox.
- Chromium blocks requests from an opaque origin to a loopback address. A test that loads scene files in the browser must turn off `LocalNetworkAccessChecks` for its own launch.
- The draft server runs with `tests/shared/development-server.config.mjs`.
- That configuration disables HMR, so the server never reloads a page under test.
- Use `DRAFT_ORIGIN` from the browser fixtures for its address.
- Prove a new assertion can fail. Break the behavior, watch the test fail, then restore it. An assertion that never fails is not coverage.
- `npm run verify` runs both test runners. The browser layer uses the local Cloudflare runtime and needs Chromium. Run `npx playwright install chromium` once per machine.
