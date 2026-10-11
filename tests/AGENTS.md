# cristianvega.ai tests: agent instructions

These rules add to the root `AGENTS.md`. Read them before you add, move, or change a test.

## Language and naming

Use the root `AGENTS.md` for general language and naming rules.
Apply its STE writing principles to test descriptions, assertion messages, and comments.
Treat code and filename naming as a repository adaptation of STE technical terminology.

- State the subject, condition, and expected behavior in each test description.
- Keep assertion messages useful when the test fails.
- Name each test file by its tested module or behavior.
- Keep `.test.mjs` for Node suites and `.spec.mjs` for browser suites.
- Preserve clear names, assertion inputs, case counts, and cleanup behavior during naming changes.
- Preserve the native and production names listed in root `AGENTS.md`.

| Item | Example |
| --- | --- |
| Description | The article menu restores button focus when Escape closes it. |
| Assertion message | Article menu: Escape must restore button focus. |
| Local identifier | `viewportWidth` or `articleIndex` |
| Node filename | `graphics-geometry.test.mjs` |
| Browser filename | `article-menu.spec.mjs` |
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
| Unit | `tests/unit/easing.test.mjs` | Clamping and cubic-point endpoint results. |
| Unit | `tests/unit/label-font.test.mjs` | Measured width caching, refreshed metrics, supplied font families, and size fallback. |
| Unit | `tests/unit/route-lengths.test.mjs` | Cumulative route lengths for fixed points. |
| Unit | `tests/unit/graphics-math.test.mjs` | Fixed staggering, smoothing, and interpolation results. |
| Unit | `tests/unit/labels.test.mjs` | Label placement, rectangle overlap, and segment intersections. |
| Unit | `tests/unit/palette.test.mjs` | Glow stops from a resolved color, with the color alpha. |
| Unit | `tests/unit/product-orbit-capacity.test.mjs` | Empty content, slot capacity, and overflow rejection. |
| Property | `tests/property/404-model.test.mjs` | Missing star geometry in columns and bands. |
| Property | `tests/property/about-layout.test.mjs` | Path shape and ring bounds in columns and bands. |
| Property | `tests/property/easing.test.mjs` | Cubic easing endpoints and monotonic samples. |
| Property | `tests/property/globe-model.test.mjs` | Node bounds, route connections, Vega endpoints, and cumulative route lengths. |
| Property | `tests/property/entrance-clock.test.mjs` | Entrance endpoints and monotonic clock samples. |
| Property | `tests/property/graphics-geometry.test.mjs` | Valid star indices, padded Lyra layout, and mesh bounds. |
| Property | `tests/property/graphics-math.test.mjs` | Stable numeric samples in the unit interval. |
| Property | `tests/property/product-orbit.test.mjs` | Progress endpoints and ordering, distinct orbit slots, and Lyra bounds. |
| Property | `tests/property/writing-layout.test.mjs` | Article point counts, physical bounds, connected paths, and unique valid links. |
| Integration | `tests/integration/build.test.mjs` | Static file safety, sitemap completeness, local font references, and private image exclusions. |
| Integration | `tests/integration/pages.test.mjs` | Owner content, landmarks, metadata consistency, navigation state, safe outbound links, and local fonts. |
| Integration | `tests/integration/publication.test.mjs` | Production routes, draft privacy, rendered publication, content order, escaped metadata, and product build capacity. |
| Integration | `tests/integration/public-asset-guard.test.mjs` | The prebuild guard keeps operating system metadata out of public assets. |
| Integration | `tests/integration/security.test.mjs` | Cloudflare header and cache rules, the CSP, and `security.txt`. |
| Integration | `tests/integration/deployment-gate.test.mjs` | Verified build acceptance, representative broken responses, unsafe script URLs, approved headers, and the local Cloudflare build. |
| Integration | `tests/integration/deployment-workflow.test.mjs` | Parsed workflow triggers, action pins, token scope, secrets, freshness conditions, and artifact integrity. |
| Integration | `tests/integration/node-version.test.mjs` | Exact .nvmrc format and the actual test runtime. |
| Integration | `tests/integration/motion-styles.test.mjs` | Reduced motion reset and compiled CSS entrance preferences. |

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
`npm run test:run` runs all three Node types through explicit globs.
`npm run test:browser` runs the same Playwright suite.
`npm test` builds and runs all Node tests.
`npm run verify` builds, checks Astro diagnostics, and runs both runners.

## End-to-end ownership

| File | Owns |
| --- | --- |
| `tests/end-to-end/home.spec.mjs` | Readable content, visible globe, navigation, publication links, keyboard access, reduced motion, and frame completion. |
| `tests/end-to-end/globe-presentation.spec.mjs` | Globe label clocks, hidden tabs, restored entrances, motion preferences, and stylesheet failure. |
| `tests/end-to-end/products.spec.mjs` | Basic product list and detail navigation, responsive reading, and production draft privacy. |
| `tests/end-to-end/404.spec.mjs` | Real 404 status, return navigation, and readable content without JavaScript. |
| `tests/end-to-end/about.spec.mjs` | Reader tracking, pages without scrolling, reduced motion, reading without JavaScript, and scroll listener cleanup. |
| `tests/end-to-end/writing.spec.mjs` | Basic article navigation, draft privacy, keyboard and pointer interactions, readable controls, fallbacks, reduced motion, and cleanup. |
| `tests/end-to-end/article-interactions.spec.mjs` | Article code and diagram names, roles, focus order, and the scope of the article setup. |
| `tests/end-to-end/article-menu.spec.mjs` | The article menu at minimum width: text contrast, focus rings, and the current link. |
| `tests/end-to-end/publication.spec.mjs` | Published content in an isolated production build: routes, sitemap, robots, navigation, scripts, and the copy link. |
| `tests/end-to-end/canvas-controller.spec.mjs` | Controller clocks, observers, motion preferences, restoration, resource cleanup, bitmap cropping, and failure fallbacks. |
| `tests/end-to-end/page-graphics.spec.mjs` | Decorative scenes, readable content, reduced motion, and product clock completion. |
| `tests/end-to-end/graphic-font.spec.mjs` | Missing and delayed fonts, measured labels, resizing, pending motion preferences, and font callback lifetimes. |
| `tests/end-to-end/layout.spec.mjs` | Shell readability, responsive navigation, keyboard focus, skip links, article anchors, and reading without JavaScript. |
| `tests/end-to-end/hosting.spec.mjs` | Local Cloudflare headers, redirects, preview indexing, compression, caching, security contact, and refused requests. |
| `tests/end-to-end/security.spec.mjs` | The browser enforces the CSP and the permissions policy. |
| `tests/end-to-end/analytics.spec.mjs` | The Cloudflare beacon loads on the production origin only, and pages work when it is blocked. |

Keep page selectors and expectations in their owning suite.
Share identical navigation, settlement, frame, and pixel mechanisms through `tests/shared/browser-fixtures.mjs`.
Pass page selectors and alpha thresholds to the pixel helpers.

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
- Use coarse device pixel ratio checks when bitmap scaling can clip a scene.
- Keep basic draft navigation, implemented interactions, and production privacy.
- Require an explicit owner requirement before adding exhaustive checks for draft visuals.
- Share each isolated build when its fixture and production inputs match.
- Keep route and rendered publication assertions together in `tests/integration/publication.test.mjs`.
- Use physical bounds for graphics. Use exact decorative values only for an explicit owner requirement.
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
- The site scrolls smoothly. Scroll with `behavior: "instant"` before you measure, or poll for the scroll result.
- A test must pass with drafts and with published entries. Derive expected content from `tests/shared/node-helpers.mjs`, including `publishedContent` and `headerLinks`.
- The draft server runs with `tests/shared/development-server.config.mjs`.
- That configuration disables HMR, so the server never reloads a page under test.
- Use `DRAFT_ORIGIN` from the browser fixtures for its address.
- Prove a new assertion can fail. Break the behavior, watch the test fail, then restore it. An assertion that never fails is not coverage.
- `npm run verify` runs both test runners. The browser layer uses the local Cloudflare runtime and needs Chromium. Run `npx playwright install chromium` once per machine.
