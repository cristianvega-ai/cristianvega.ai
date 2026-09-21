# cristianvega.ai tests: agent instructions

These rules add to the root `AGENTS.md`. Read them before you add, move, or change a test.

## Testing strategy

The suite has two runners and one file per concern. Put each new test in the layer that can observe the behavior. Do not add tests to whichever file is largest.

| Layer | File | Owns |
| --- | --- | --- |
| Unit | `tests/lib.test.mjs` | Pure helpers in `src/lib/`. No DOM, no build output. |
| Build | `tests/build.test.mjs` | The build emits every expected route, asset, feed, and sitemap entry. |
| Pages | `tests/pages.test.mjs` | Rendered HTML content, headings, metadata, and navigation state. |
| Security | `tests/security.test.mjs` | Cloudflare header rules, the CSP, and the post-deploy gate. |
| Deployment | `tests/deploy-gate.test.mjs` | The live gate accepts the verified build and rejects broken responses. |
| Design tokens | `tests/design-tokens.test.mjs` | Design-token hygiene in `global.css`. |
| Selector hygiene | `tests/css-hygiene.test.mjs` | A class that is the subject of `:focus` or `:focus-visible` must be able to receive focus. |
| CSS | `tests/motion-css.test.mjs` | Rules that must survive compilation, such as the reduced-motion contract. |
| Behavior | `tests/e2e/*.spec.mjs` | Computed layout, sticky and responsive rules, focus, and runtime JavaScript. |

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
