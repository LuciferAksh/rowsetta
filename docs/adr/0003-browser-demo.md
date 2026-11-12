# 0003: Ship the browser demo with the lite model

Status: accepted, measured locally on 2026-11-11.

## Decision

TabICLv2 does **not** ship in the browser yet. Both the four-estimator run and
the eight-estimator retry miss probability parity with the Python model. The
browser demo ships with the lite model (random forest) instead. The local app retains its
four-estimator TabICLv2 teacher. A missing upload token did not decide this:
the spike served verified ONNX weights from a local HTTP path. Nothing was
uploaded and no Hugging Face write token was used.

## Local evidence

Machine: Apple M5, 32 GiB RAM. Headed Chromium through the installed Brave
executable, with `navigator.gpu.requestAdapter()` asserted before model loading
and `model.backend === 'webgpu'` asserted afterward. Other jobs were running on
the machine, so these latency figures are observations under that load.

`forecast-web` 1.0.0 and ONNX Runtime Web 1.31.1 use fp16 weights from upstream
revision `098fb7be8df8a853a9d7f54a344ee9c6734a53d1`. The staging script verifies
the graph and external weights against the reviewed SHA-256 pins in ADR 0009
on both download and cached reads. Python uses tabicl 2.2.0, seed 7 and the
pinned native checkpoint. `teacher_frame` supplies both paths' identical inputs.
Probability columns are aligned by class name before comparison.

| Estimators | Dataset | Max absolute difference | Stable-margin class flips | Near ties |
| --- | --- | --- | --- | --- |
| 4 | penguins | 0.216487 | 3 | 1 |
| 4 | bank_2k | 0.591745 | 149 | 5 |
| 4 | adult_2k | 0.286585 | 81 | 7 |
| 8 | penguins | 0.124360 | 2 | 0 |
| 8 | bank_2k | 0.506147 | 1406 | 3 |
| 8 | adult_2k | 0.504155 | 1283 | 3 |

The probability gate is max difference <= 0.002 on every row. Stable-margin
flips must be zero where Python's top-two margin exceeds 0.004; near ties are
counted separately. Both gates fail at both estimator counts. These results
establish a deployment no-go, not the root cause of the implementations' difference.

Latency is refit plus prediction of the whole working table, median of five
runs after one warm-up, with 20 human labels for penguins and 50 for bank_2k.
All timing budgets pass; passing latency does not override failed parity.

| Estimators | Penguins, budget 3.0 s | bank_2k, budget 10.0 s |
| --- | --- | --- |
| 4 | 0.4028 s | 3.1846 s |
| 8 | 0.6834 s | 5.2866 s |

The full five-run samples are retained in
[spike-4.json](../browser-evidence/spike-4.json) and
[spike-8.json](../browser-evidence/spike-8.json).

## Reproduce without a mirror

```sh
uv run python scripts/mirror_onnx.py --local frontend/public/spike/weights
uv run python scripts/make_parity_golden.py --estimators 4
pnpm --dir frontend dev
# In another terminal; repeat golden generation and this command at 8 estimators:
uv run python scripts/bench_browser.py
node scripts/pyodide_unit.mjs
```

The parity harness is a separate Vite entry, `frontend/parity.html`, independent
of the SPA. Its generated inputs and weights are ignored by Git and are never
copied into `site/`. `scripts/bench_browser.py` prints measurements; a no-go is
a recorded decision rather than a reason to pretend the measurements passed.
See ADR 0007 for Pyodide compatibility and the shipped build's checks.
