# 0007: A static, self-contained Pyodide demo

Status: implemented; final acceptance results recorded below.

## Teacher and shared core

ADR 0003 records the probability-parity failure: four-estimator maximum
differences are 0.216487, 0.591745 and 0.286585; at eight they are 0.124360,
0.506147 and 0.504155. These exceed 0.002 despite passing latency (penguins
0.4028 / 0.6834 s at four/eight; bank 3.1846 / 5.2866 s, budget 10 s).

The browser uses `LiteTeacher`, a seeded 200-tree random forest with training-only
ordinal category encoding, unknown categories treated as missing, and native
NaN routing. The six-label penguins protocol scores 0.866864 versus a 0.443787
majority baseline. Header, accuracy panel, certificates and README all identify
the lite model (random forest), not TabICLv2. The benchmark runner exposes it as
the `lite` learner. No ONNX teacher worker or model download ships in this build.

`browser_shell.py` owns an in-memory `Workspace` and calls the existing core for
labels, evaluation, selection, leaks, distillation, sessions and every export
format. No model logic is reimplemented in JavaScript. Export execution is
`NotExecuted("browser demo")`; DuckDB, torch and FastAPI are never packaged or
loaded in the browser. Full-model fit-limit boundaries remain independently
tested at 1,250 x 16 and 1,251 x 16, but do not restrict the lite teacher.

## Build and loading

`make browser` packages the core into a pure wheel, stages Pyodide 314.0.7 and
its locked scientific/Pydantic packages, then builds the existing SPA to `site/`.
The existing Pages workflow already builds and deploys that directory. Relative
asset URLs allow a repository subpath. No account or model mirror is
needed to build or use the static files; opening the site requires an HTTP(S)
origin, as workers cannot run from `file://`.

Unlike the CDN download, runtime packages are hosted with the page.
This keeps runtime availability tied to the same deploy, without changing any
package version. Package bytes are checked against Pyodide's lock at build time.
A build manifest pins the staged assets. Worker fetches verify SHA-256 on both
Cache Storage hits and downloads; corrupt hits are discarded and fetched again.
JavaScript modules use ordinary browser module caching. Runtime progress reports
verified bytes; there is no model progress line on the lite path.

The shell first paints a target-masked static copy of penguins. Runtime loading
starts in parallel; the backend optimistically records early labels and queues
worker commands in order, then publishes only the latest mutation's state.
The queue lives in the browser backend rather than adding a second queue to
the shared UI state. This preserves the local app and finished visual design.

Uploads are limited to 50 MB and use the same seeded loader with a 2,000-row
cap. UTF-8 decoding is strict and preserves a BOM for source fingerprints.
Existing-column prefill and label-audit controls are hidden in the browser;
new targets teach from scratch. The CSP permits only the origin and jsDelivr
for connections, with no Hugging Face hosts, analytics, or form submissions.

## Verification and task boxes

The unit runner mounts source and unit tests in Pyodide under Node. Native-only
modules that import shell dependencies during collection are ignored before
collection, and native tests are deselected. Hypothesis and jsonschema are
test-only packages, not included in the site. An initial collection failure and
a transient jsonschema download failure were repaired rather than being treated
as evidence that the core could not run in Pyodide.

The source-mounted Pyodide suite passes: **239 passed, 31 native tests
deselected**.
The browser suite passes **six tests**: queued labels, proposals and SQL export,
plus failed-WASM-download recovery, in Chromium, Firefox and WebKit. The network
assertion permits only same-origin GETs without request bodies or query strings.
The frontend suite passes **205 tests**, with zero lint or type errors.

The failure probe found that Emscripten can leave startup pending after a failed
WASM fetch. The worker now reports fetch failures directly and the backend stops
the failed worker, preserves displayed early labels and presents a recovery step.

The unbudgeted clean-profile smoke uses headed Chromium on the M5 at 50 Mbit/s
down, 10 Mbit/s up and 40 ms latency. It records the milestones before waiting
for lazy assets to settle, so startup timing and first-visit bytes are distinct.
Cached responses with negative Playwright body-size sentinels count as zero.
The frozen source is `cold_start.browser` in `docs/bench.json`; `docs/bench.md`
is regenerated from it.

| Visit | Table labelable | First proposals | Response body bytes transferred |
| --- | --- | --- | --- |
| Cold | 1.131914 s | 22.413568 s | 43047823 |
| Warm | 0.201800 s | 14.081791 s | 0 |

The `--no-budget` smoke passes. The warm visit misses its 6 s target, although the cold visit meets the 10 s table / 30 s
proposal targets. The script enforces browser budgets separately from the
local-install 180 s / 15 s budgets; boundary tests cover both browser milestones.
The figures were measured locally under concurrent machine load, not on a
published Pages URL. No public cold-start promise is made from these numbers.

`make check` exited 0: 467 Python tests passed, 12 model/PostgreSQL tests were
deselected, and 205 frontend tests passed across 13 files. Ruff formatting and
lint, Pyright, Prettier, ESLint, Svelte/TypeScript, OpenAPI drift and copy checks
all passed. Both `make browser` and the ordinary local-app frontend build exited
0. The browser smoke command is:

```sh
pnpm --dir frontend exec playwright test --config playwright.browser.config.ts
```
