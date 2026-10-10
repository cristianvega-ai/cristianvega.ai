# cristianvega.ai tests: agent instructions

These rules add to the root `AGENTS.md`. Read them before you add, move, or change a test.

## Testing strategy

The suite has two runners. Each suite owns one concern. Put checks in the layer that observes the failure.

| Layer | File | Owns |
| --- | --- | --- |
| Easing | `tests/easing.test.mjs` | Clamping, cubic easing, and cubic points. |
| Globe model | `tests/globe-model.test.mjs` | Node bounds, route connections, Vega endpoints, and cumulative route lengths. |
| Graphic clock | `tests/graphics-clock.test.mjs` | Page graphic entrance progress. |
| Graphic math | `tests/graphics-math.test.mjs` | Staggering, smoothing, interpolation, and stable numeric samples. |
| Graphic geometry | `tests/graphics-geometry.test.mjs` | Star indices, padded Lyra layout, cumulative route lengths, and mesh bounds. |
| Labels | `tests/labels.test.mjs` | Label placement, rectangle overlap, and segment intersections. |
| Graphic fonts | `tests/graphic-font.test.mjs` | Measured width caching, refreshed metrics, supplied font families, and size fallback. |
| About model | `tests/about-model.test.mjs` | Path shape and ring bounds in columns and bands. |
| Products model | `tests/products-model.test.mjs` | Capacity, empty content, progress endpoints, distinct slots, and basic Lyra bounds. |
| 404 model | `tests/404-model.test.mjs` | Missing star geometry in columns and bands. |
| Writing model | `tests/writing-model.test.mjs` | Article point counts, physical bounds, connected paths, and unique valid links. |
| Palette | `tests/palette.test.mjs` | Glow stops from a resolved color, with the color alpha. |
| Build | `tests/build.test.mjs` | Static file safety, sitemap completeness, local font references, and private image exclusions. |
| Pages | `tests/pages.test.mjs` | Owner content, landmarks, metadata consistency, navigation state, safe outbound links, and local fonts. |
| Publication | `tests/publication.test.mjs` | Production routes, draft privacy, rendered publication, content order, escaped metadata, and product build capacity. |
| Public input | `tests/public-input.test.mjs` | The prebuild guard keeps operating system metadata out of public assets. |
| Security | `tests/security.test.mjs` | Cloudflare header and cache rules, the CSP, and `security.txt`. |
| Deployment | `tests/deploy-gate.test.mjs` | Verified build acceptance, representative broken responses, unsafe script URLs, approved headers, and the local Cloudflare build. |
| Workflow | `tests/deploy-workflow.test.mjs` | Parsed workflow triggers, action pins, token scope, secrets, freshness conditions, and artifact integrity. |
| Node version | `tests/node-version.test.mjs` | Exact .nvmrc format and the actual test runtime. |
| CSS | `tests/motion-styles.test.mjs` | Reduced motion reset and compiled CSS entrance preferences. |

Unit suites read pure helpers. They do not read the DOM or build output.

The deployment suite starts Wrangler on `dist/`. `npm run test:run` therefore needs a current `dist/` and the installed Wrangler.

## Browser ownership

| File | Owns |
| --- | --- |
| `tests/browser/home.spec.mjs` | Readable content, visible globe, navigation, publication links, keyboard access, reduced motion, and frame completion. |
| `tests/browser/globe-presentation.spec.mjs` | Globe label clocks, hidden tabs, restored entrances, motion preferences, and stylesheet failure. |
| `tests/browser/products.spec.mjs` | Basic product list and detail navigation, responsive reading, and production draft privacy. |
| `tests/browser/404.spec.mjs` | Real 404 status, return navigation, and readable content without JavaScript. |
| `tests/browser/about.spec.mjs` | Reader tracking, pages without scrolling, reduced motion, reading without JavaScript, and scroll listener cleanup. |
| `tests/browser/writing.spec.mjs` | Basic article navigation, draft privacy, keyboard and pointer interactions, readable controls, fallbacks, reduced motion, and cleanup. |
| `tests/browser/article-interactions.spec.mjs` | Article code and diagram names, roles, focus order, and the scope of the article setup. |
| `tests/browser/article-menu.spec.mjs` | The article menu at minimum width: text contrast, focus rings, and the current link. |
| `tests/browser/publication.spec.mjs` | Published content in an isolated production build: routes, sitemap, robots, navigation, scripts, and the copy link. |
| `tests/browser/canvas-controller.spec.mjs` | Controller clocks, observers, motion preferences, restoration, resource cleanup, bitmap cropping, and failure fallbacks. |
| `tests/browser/page-graphics.spec.mjs` | Decorative scenes, readable content, reduced motion, and product clock completion. |
| `tests/browser/graphic-font.spec.mjs` | Missing and delayed fonts, measured labels, resizing, pending motion preferences, and font callback lifetimes. |
| `tests/browser/layout.spec.mjs` | Shell readability, responsive navigation, keyboard focus, skip links, article anchors, and reading without JavaScript. |
| `tests/browser/hosting.spec.mjs` | Local Cloudflare headers, redirects, preview indexing, compression, caching, security contact, and refused requests. |
| `tests/browser/security.spec.mjs` | The browser enforces the CSP and the permissions policy. |
| `tests/browser/analytics.spec.mjs` | The Cloudflare beacon loads on the production origin only, and pages work when it is blocked. |

Keep page selectors and expectations in their owning suite.
Share identical navigation, settlement, frame, and pixel mechanisms through `tests/browser/fixtures.mjs`.
Pass page selectors and alpha thresholds to the pixel helpers.

To choose a layer, ask what the test must look at:

1. A pure function — use the unit layer.
2. A string that must appear in `dist/` — use the matching contract layer.
3. Anything a browser must compute or execute — use the browser layer.

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
- Keep route and rendered publication assertions together in `tests/publication.test.mjs`.
- Use physical bounds for graphics. Use exact decorative values only for an explicit owner requirement.
- Keep owner branding fixed.
- Compare changing profile text with rendered metadata.
- Require nonempty inputs before looping over expected elements.
- Include the subject, input, and expected result in failure messages.
- Preserve security, draft privacy, keyboard access, motion preferences, fallbacks, and resource cleanup.

## Rules

- Apply the naming rules to local test variables, parameters, object fields, and imported aliases.
- Do not assert on `.astro` or `.ts` source text. A regular expression over source proves only that the code looks correct. It passes when the behavior is broken, and it fails after a safe rename. If a guarantee needs the browser, write a browser spec instead.
- Node tests end in `.test.mjs`. Browser specs end in `.spec.mjs`. The `tests/*.test.mjs` glob is not recursive, which is what keeps the two runners apart. Never name a browser spec `.test.mjs`, and never put a Node test in `tests/browser/`.
- Share browser helpers through `tests/browser/fixtures.mjs` and Node helpers through `tests/helpers.mjs`. Do not copy a helper into a second file.
- To test changed source or content, build a copy with `createIsolatedBuild` or `createContentBuild` from `tests/helpers.mjs`. Do not change the source of the repository in a test.
- Browser specs must be deterministic. Use Playwright's auto-waiting or `expect.poll`. Never use a fixed sleep.
- Wait for the page entrance animation before you measure geometry. Use `settle(page)` from the fixtures. Geometry read during the animation is the animation's, not the layout's.
- The site scrolls smoothly. Scroll with `behavior: "instant"` before you measure, or poll for the scroll result.
- A test must pass with drafts and with published entries. Derive the expected content from the inventory helpers in `tests/helpers.mjs`, such as `publishedContent` and `headerLinks`.
- The draft server runs with `tests/browser/development-server.config.mjs`. That configuration disables HMR, so the server never reloads a page under test. Use `DRAFT_ORIGIN` from the fixtures for its address.
- Prove a new assertion can fail. Break the behavior, watch the test fail, then restore it. An assertion that never fails is not coverage.
- `npm run verify` runs both test runners. The browser layer uses the local Cloudflare runtime and needs Chromium. Run `npx playwright install chromium` once per machine.
