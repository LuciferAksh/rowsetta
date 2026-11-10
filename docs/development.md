# Development notes

## Registry verification

Checked public PyPI JSON and npm registry metadata on 2026-11-05. Versions below
are the latest stable versions reported by each registry, not benchmark results.
Python packages resolve in `uv.lock`; frontend direct dependencies are exact pins.

| Registry | Package | Latest stable |
| --- | --- | --- |
| PyPI | `uv` | 0.13.7 |
| PyPI | `tabicl` | 2.2.0 |
| PyPI | `torch` | 2.15.0 |
| PyPI | `scikit-learn` | 1.9.1 |
| PyPI | `pandas` | 3.1.1 |
| PyPI | `numpy` | 2.5.4 |
| PyPI | `scipy` | 1.18.1 |
| PyPI | `duckdb` | 2.0.0 |
| PyPI | `psycopg` | 3.3.8 |
| PyPI | `dbt-core` | 1.12.6 |
| PyPI | `dbt-duckdb` | 1.11.1 |
| PyPI | `fastapi` | 0.162.0 |
| PyPI | `uvicorn` | 0.54.0 |
| PyPI | `huggingface-hub` | 2.4.0 |
| PyPI | `hypothesis` | 6.170.14 |
| PyPI | `hatchling` | 1.33.0 |
| PyPI | `fonttools` | 4.68.0 |
| PyPI | `tabpfn` | 9.2.0 |
| PyPI | `orbital` | 0.6.0 |
| PyPI | `ruff` | 0.17.3 |
| PyPI | `pyright` | 1.1.414 |
| PyPI | `pytest` | 9.2.0 |
| PyPI | `httpx` | 0.28.1 |
| PyPI | `pydantic` | 2.14.2 |
| npm | `svelte` | 5.57.3 |
| npm | `vite` | 8.3.6 |
| npm | `typescript` | 7.0.2 |
| npm | `@sveltejs/vite-plugin-svelte` | 7.3.1 |
| npm | `@types/node` (26.x) | 26.6.6 |
| npm | `svelte-check` | 4.7.8 |
| npm | `eslint` | 10.14.0 |
| npm | `typescript-eslint` | 8.72.1 |
| npm | `eslint-plugin-svelte` | 3.24.0 |
| npm | `prettier` | 3.9.10 |
| npm | `prettier-plugin-svelte` | 4.1.1 |
| npm | `markdownlint-cli2` | 0.24.0 |
| npm | `vitest` | 5.1.0 |
| npm | `@playwright/test` | 1.64.1 |
| npm | `@axe-core/playwright` | 4.14.0 |
| npm | `forecast-web` | 1.0.0 |
| npm | `onnxruntime-web` | 1.31.1 |
| npm | `pyodide` | 314.0.7 |
| npm | `pnpm` | 12.16.1 |
| PyPI | `pre-commit` | 4.7.0 |

Sources: `https://pypi.org/pypi/<package>/json` and
`https://registry.npmjs.org/<package>/latest`.

- Updated pandas from the 3.1.0 to 3.1.1 and Vite from 8.3.5 to 8.3.6
  under engineering standards section 5a. Re-confirmed both registry versions on
  2026-11-05; `uv.lock` retains pandas 3.1.1 and the frontend retains Vite 8.3.6.
  Pyodide floors remain unchanged.
- Pinned `@types/node` 26.6.6 as a frontend development dependency on
  2026-11-05, the latest stable 26.x release reported by
  `https://registry.npmjs.org/@types%2fnode`, to match Node 26 LTS. Its required
  `undici-types` dependency is transitive. No other direct dependency was added.
  These declarations satisfy the Vite and Vitest Node types without weakening
  TypeScript, Svelte or ESLint checks.
- TypeScript stays at 6.0.3 although 7.0.2 is available: typescript-eslint 8.72.1
  requires a version below 6.1.0. Keep this dependency ceiling.
- Build backend: hatchling 1.33.0. Pre-commit 4.7.0 is included to make setup
  reproducible. No product dependency outside the planned stack was added.
- Installed tools reported uv 0.13.7, Node 26.13.0 and gitleaks 8.30.1.
  pnpm 12.16.1 was installed in temporary tooling storage for verification.
- Confirmed torch 2.15.0 in `https://download.pytorch.org/whl/cpu/torch/`.
  The Linux/Windows explicit CPU source is configured before the first lock.
- NOTICE retains the TabICL sdist licence, including its Apache-2.0 forecast
  attribution, and forecast-web 1.0.0's npm NOTICE. No model was downloaded.
  Browser code review and vendoring remain pending, so forecast-web is not installed yet.

## Pending work

- TODO: final name and accepted trademark search. See ADR 0000.
- TODO: no remote. The workflows pin every action to a full commit SHA and pass
  `actionlint`, but none has run on GitHub. Enable PR checks and Dependabot,
  protect main and configure CodeQL default setup. The CPU-source
  before/after CI measurement cannot run without a remote.
- TODO: supply the Hugging Face token locally for the weight
  mirror. It is unnecessary for scaffold checks.
- TODO before public release: set private security and conduct contacts, citation
  authorship and repository URL.
- TODO: development-container implementation and a real Codespaces check.
- Release runs on a `v*` tag; Pages and the install smoke run only when
  dispatched or called by the release.
- `dev` starts only Vite until the API exists. The future API proxy is set to
  127.0.0.1:8787. `bench`, `bench-full`, `golden`, `demo-gif` and `browser` fail
  with an explicit TODO rather than reporting an unimplemented operation as passed.
- The Svelte page is unstyled. Visual direction remains pending.
- README contains a technical scaffold description. Final hero copy is pending.

## Verification

Acceptance commands and their observed results are recorded after execution.

- `uv run tabular-studio --help`: exit 0; usage and working-title description printed.
- `gitleaks git --redact`: exit 0, no leaks. The branch has no commits, so the
  history scan covered zero bytes. A separate `gitleaks dir` scan of the
  unignored source files also exited 0 with no leaks.
- TOML, frontend JSON and GitHub YAML parsed successfully.
- `uv run pre-commit validate-config`: exit 0 using a writable temporary cache.
- `pnpm --dir frontend test`: one test passed.
- `make build`: frontend assets, Python sdist and wheel built successfully.
  Package inspection found that hatchling does not apply `.git/info/exclude`;
  the sdist uses an explicit allowlist of package inputs.
- Initial `make check` failed on absent Node declarations. Adding the pinned
  declarations resolved the errors with the existing strict settings unchanged.

### Final scaffold acceptance, 2026-11-05

`pnpm --dir frontend install --frozen-lockfile` exited 0 and reported that the
lockfile is up to date. The only new packages are `@types/node` 26.6.6 and its
required transitive dependency, `undici-types` 8.9.0.

`make check` exited 0. Python formatting and lint passed, pyright reported zero
errors and warnings, and both CLI tests passed. Frontend formatting and ESLint
passed. The frontend check ran both `svelte-check --tsconfig ./tsconfig.json`
and `tsc --noEmit`; its summary was:

```text
COMPLETED 444 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
```

The final test output was:

```text
Test Files  1 passed (1)
     Tests  1 passed (1)
```

`uv run tabular-studio --help` exited 0 and printed:

```text
usage: tabular-studio [-h]

Tabular Studio (working title): local tabular labelling and rule export.

options:
  -h, --help  show this help message and exit
```

`gitleaks git --redact` exited 0 with the following tail. This branch still has
no commits, so this acceptance command checks no history content:

```text
INF 0 commits scanned.
INF scanned ~0 bytes (0) in 29.4ms
INF no leaks found
```

Scaffold acceptance passes. The pending work above remains unchanged.
