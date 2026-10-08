# cristianvega.ai tests: agent instructions

These rules add to the root `AGENTS.md`. Read them before you add, move, or change a test.

## Testing strategy

The suite has two runners and one file per concern. Put each new test in the layer that can observe the behavior. Do not add tests to whichever file is largest.

| Layer | File | Owns |
| --- | --- | --- |
| Easing | `tests/easing.test.mjs` | Clamping, cubic easing, and cubic points. |
| Globe model | `tests/globe-model.test.mjs` | Globe geometry, routes, entrance order, label anchors, the projection crop, and the rounding of projection values. |
| Graphic clock | `tests/graphics-clock.test.mjs` | Page graphic entrance progress. |
| Graphic math | `tests/graphics-math.test.mjs` | Staggering, smoothing, interpolation, and stable numeric samples. |
| Graphic geometry | `tests/graphics-geometry.test.mjs` | Lyra layout, constellation links, route lengths, meshes, and figure insets. |
| Labels | `tests/labels.test.mjs` | Label placement, rectangle overlap, and segment intersections. |
| Graphic fonts | `tests/graphic-font.test.mjs` | Font measurement, width caching, and measured placement inputs. |
| About model | `tests/about-model.test.mjs` | About path geometry, orientation, and ring margins. |
| Products model | `tests/products-model.test.mjs` | Product capacity and its build guard, entrance timing, slots, orbits, mark reach, and Lyra fitting. |
| 404 model | `tests/404-model.test.mjs` | Missing star layout, search timing, names, and insets. |
| Writing model | `tests/writing-model.test.mjs` | Writing field placement, links, labels, and insets. |
| Palette | `tests/palette.test.mjs` | Glow stops from a resolved color, with the color alpha. |
| Build | `tests/build.test.mjs` | The build emits every expected route, asset, feed, and sitemap entry. |
| Pages | `tests/pages.test.mjs` | Rendered HTML content, headings, metadata, and navigation state. |
| Diagnostics | `tests/diagnostics.test.mjs` | The real `astro check` reports source files and skips generated and tool folders. |
| Public input | `tests/public-input.test.mjs` | The prebuild guard keeps operating-system metadata out of `public/`. |
| Security | `tests/security.test.mjs` | Cloudflare header and cache rules, the CSP, and `security.txt`. |
| Deployment | `tests/deploy-gate.test.mjs` | The live gate accepts the verified build and rejects broken responses. The gate also runs against the local Cloudflare build. |
| Workflow | `tests/deploy-workflow.test.mjs` | Workflow triggers, action pins, token scope, secrets, and the deploy conditions. |
| Node version | `tests/node-version.test.mjs` | The tests and Cursor setup use the exact version in `.nvmrc`. |
| Design tokens | `tests/design-tokens.test.mjs` | Design-token hygiene in `global.css`, and the allowlist of global tokens that a page stylesheet can redefine. |
| Selector hygiene | `tests/stylesheet-selector-hygiene.test.mjs` | A class that is the subject of `:focus` or `:focus-visible` must be able to receive focus. |
| CSS | `tests/motion-styles.test.mjs` | Rules that must survive compilation, such as the reduced-motion contract, and the ban on CSS `round()`. |
| Behavior | `tests/browser/*.spec.mjs` | Computed layout, sticky and responsive rules, focus, and runtime JavaScript. |

Unit suites read pure helpers. They do not read the DOM or build output.

The deployment suite starts Wrangler on `dist/`. `npm run test:run` therefore needs a current `dist/` and the installed Wrangler.

## Browser ownership

| File | Owns |
| --- | --- |
| `tests/browser/home.spec.mjs` | Homepage layout, content links, publication state, and the globe. |
| `tests/browser/globe-presentation.spec.mjs` | Globe presentation from model inputs, label clock behavior, projection stylesheet delivery, fallbacks, backdrop alignment, and the label size token. |
| `tests/browser/products.spec.mjs` | Product index and detail flows, metadata, graphic bindings, marks, capacity, labels, and bounds. |
| `tests/browser/404.spec.mjs` | 404 graphic search, labels, bounds, fallback, content visibility, and console behavior. |
| `tests/browser/about.spec.mjs` | About graphic layout, reader interaction, and page expectations. |
| `tests/browser/writing.spec.mjs` | Writing navigation, article flows, and writing graphic expectations. |
| `tests/browser/article-interactions.spec.mjs` | Article code and diagram names, roles, focus order, and the scope of the article setup. |
| `tests/browser/article-menu.spec.mjs` | The article menu at narrow widths: text contrast, focus rings, and the current link. |
| `tests/browser/publication.spec.mjs` | Published content in an isolated production build: routes, sitemap, robots, navigation, scripts, and the copy link. |
| `tests/browser/canvas-controller.spec.mjs` | Controller policies, clocks, observers, listeners, restoration, and resource cleanup. |
| `tests/browser/page-graphics.spec.mjs` | Shared graphic entrance, reduced motion, pause, rest, and restoration contracts. |
| `tests/browser/graphic-font.spec.mjs` | CSS font tokens, delayed fonts, measured labels, resizing, and font callback lifetimes. |
| `tests/browser/layout.spec.mjs` | Shared shell geometry, reading edges, graphic bands, and alignment across pages. |
| `tests/browser/typography.spec.mjs` | Shared typography sizes, line heights, tracking, and role order. |
| `tests/browser/palette.spec.mjs` | Graphic sky colors from the CSS token in each CSS color format, and the fallback color. |
| `tests/browser/hosting.spec.mjs` | Local Cloudflare responses: headers, redirects, robots, compression, caching, and refused requests. |
| `tests/browser/security.spec.mjs` | The browser enforces the CSP and the permissions policy. |
| `tests/browser/analytics.spec.mjs` | The Cloudflare beacon loads on the production origin only, and pages work when it is blocked. |

Keep page selectors and expectations in their owning suite.
Share identical frame and pixel mechanisms through `tests/browser/fixtures.mjs`.
Pass page selectors and alpha thresholds to the pixel helpers.

To choose a layer, ask what the test must look at:

1. A pure function — use the unit layer.
2. A string that must appear in `dist/` — use the matching contract layer.
3. Anything a browser must compute or execute — use the browser layer.

## Rules

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
