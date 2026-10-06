# cristianvega.ai tests: agent instructions

These rules add to the root `AGENTS.md`. Read them before you add, move, or change a test.

## Testing strategy

The suite has two runners and one file per concern. Put each new test in the layer that can observe the behavior. Do not add tests to whichever file is largest.

| Layer | File | Owns |
| --- | --- | --- |
| Easing | `tests/easing.test.mjs` | Clamping, cubic easing, and cubic points. |
| Globe model | `tests/globe-model.test.mjs` | Globe geometry, routes, entrance order, and label anchors. |
| Graphic clock | `tests/graphics-clock.test.mjs` | Page graphic entrance progress. |
| Graphic math | `tests/graphics-math.test.mjs` | Staggering, smoothing, interpolation, and stable numeric samples. |
| Graphic geometry | `tests/graphics-geometry.test.mjs` | Lyra layout, constellation links, route lengths, meshes, and figure insets. |
| Labels | `tests/labels.test.mjs` | Label placement, rectangle overlap, and segment intersections. |
| Graphic fonts | `tests/graphic-font.test.mjs` | Font measurement, width caching, and measured placement inputs. |
| About model | `tests/about-model.test.mjs` | About path geometry, orientation, and ring margins. |
| Products model | `tests/products-model.test.mjs` | Product capacity, entrance timing, slots, orbits, and Lyra fitting. |
| 404 model | `tests/404-model.test.mjs` | Missing star layout, search timing, names, and insets. |
| Writing model | `tests/writing-model.test.mjs` | Writing field placement, links, labels, and insets. |
| Build | `tests/build.test.mjs` | The build emits every expected route, asset, feed, and sitemap entry. |
| Pages | `tests/pages.test.mjs` | Rendered HTML content, headings, metadata, and navigation state. |
| Security | `tests/security.test.mjs` | Cloudflare header rules, the CSP, and the post-deploy gate. |
| Deployment | `tests/deploy-gate.test.mjs` | The live gate accepts the verified build and rejects broken responses. |
| Node version | `tests/node-version.test.mjs` | The tests and Cursor setup use the exact version in `.nvmrc`. |
| Design tokens | `tests/design-tokens.test.mjs` | Design-token hygiene in `global.css`. |
| Selector hygiene | `tests/css-hygiene.test.mjs` | A class that is the subject of `:focus` or `:focus-visible` must be able to receive focus. |
| CSS | `tests/motion-css.test.mjs` | Rules that must survive compilation, such as the reduced-motion contract. |
| Behavior | `tests/e2e/*.spec.mjs` | Computed layout, sticky and responsive rules, focus, and runtime JavaScript. |

Unit suites read pure helpers. They do not read the DOM or build output.

## Browser ownership

| File | Owns |
| --- | --- |
| `tests/e2e/home.spec.mjs` | Homepage layout, content links, publication state, and the globe. |
| `tests/e2e/globe-presentation.spec.mjs` | Globe presentation from model inputs and label clock behavior. |
| `tests/e2e/products.spec.mjs` | Product index and detail flows, metadata, graphic bindings, marks, capacity, labels, and bounds. |
| `tests/e2e/404.spec.mjs` | 404 graphic search, labels, bounds, fallback, content visibility, and console behavior. |
| `tests/e2e/about.spec.mjs` | About graphic layout, reader interaction, and page expectations. |
| `tests/e2e/blog.spec.mjs` | Writing navigation, article flows, and writing graphic expectations. |
| `tests/e2e/canvas-controller.spec.mjs` | Controller policies, clocks, observers, listeners, restoration, and resource cleanup. |
| `tests/e2e/page-graphics.spec.mjs` | Shared graphic entrance, reduced motion, pause, rest, and restoration contracts. |
| `tests/e2e/graphic-font.spec.mjs` | CSS font tokens, delayed fonts, measured labels, resizing, and font callback lifetimes. |
| `tests/e2e/layout.spec.mjs` | Shared shell geometry, reading edges, graphic bands, and alignment across pages. |
| `tests/e2e/typography.spec.mjs` | Shared typography sizes, line heights, tracking, and role order. |

Keep page selectors and expectations in their owning suite.
Share identical frame and pixel mechanisms through `tests/e2e/fixtures.mjs`.
Pass page selectors and alpha thresholds to the pixel helpers.

To choose a layer, ask what the test must look at:

1. A pure function — use the unit layer.
2. A string that must appear in `dist/` — use the matching contract layer.
3. Anything a browser must compute or execute — use the browser layer.

## Rules

- Do not assert on `.astro` or `.ts` source text. A regular expression over source proves only that the code looks correct. It passes when the behavior is broken, and it fails after a safe rename. If a guarantee needs the browser, write a browser spec instead.
- Node tests end in `.test.mjs`. Browser specs end in `.spec.mjs`. The `tests/*.test.mjs` glob is not recursive, which is what keeps the two runners apart. Never name a browser spec `.test.mjs`, and never put a Node test in `tests/e2e/`.
- Share browser helpers through `tests/e2e/fixtures.mjs` and Node helpers through `tests/helpers.mjs`. Do not copy a helper into a second file.
- Browser specs must be deterministic. Use Playwright's auto-waiting or `expect.poll`. Never use a fixed sleep.
- Wait for the page entrance animation before you measure geometry. Use `settle(page)` from the fixtures. Geometry read during the animation is the animation's, not the layout's.
- Prove a new assertion can fail. Break the behavior, watch the test fail, then restore it. An assertion that never fails is not coverage.
- `npm run verify` runs both test runners. The browser layer uses the local Cloudflare runtime and needs Chromium. Run `npx playwright install chromium` once per machine.
