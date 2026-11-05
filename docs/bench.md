# Teacher measurements

Measured locally on 2026-11-05 with the locked environment: TabICL 2.2.0,
torch 2.15.0, four estimators, KV cache enabled, seed 7, four CPU threads.
The checkpoint is verified against the recorded revision, SHA-256 and size.

## Six-label penguins protocol

`TABSTUDIO_RUN_MODEL=1 uv run --locked pytest -m model tests/model/test_teacher.py`
passed the required accuracy threshold of 0.80.

`uv run --locked python scripts/bench_teacher.py --drift` recorded accuracy
`0.8905325443786982` in `bench.json`: 301 correct predictions on the remaining
338 rows, including rows with missing features. `--drift --print` returned the
same value without writing the file. The schema requires this accuracy key.

One `numpy.random.default_rng(7)` generator draws two rows per species in sorted
class order from the 333 rows with no missing feature. Original source row ids:
Adelie 143 and 97; Chinstrap 336 and 315; Gentoo 179 and 252.
The model test and drift command share `penguins_protocol()` in the benchmark.

## CPU refit and predict

`uv run --locked python scripts/bench_teacher.py` completed every CPU cell below
before failing on MPS. Each value is seconds, median of five runs after one
untimed warm-up for that cell. Timing includes feature preparation, fitting,
prediction and proposal assembly. Checkpoint resolution and verification happen
before warm-up. Predictions use batches of at most 2,000 rows and omit human
rows. Training draws two rows per class first, then samples the remainder with
seed 7. All original bundled rows are used; this is not the browser 2,000-row
sample. To rerun just CPU, pass `--device cpu`.

| Dataset | Rows | 20 labels | 50 labels | 100 labels | 200 labels |
| --- | ---: | ---: | ---: | ---: | ---: |
| penguins | 344 | 0.264482 | 0.254137 | 0.259427 | 0.273293 |
| bank | 5,000 | 2.750310 | 2.651383 | 2.996841 | 3.029899 |
| adult | 5,000 | 2.676210 | 3.331844 | 2.835190 | 2.846261 |

The 5,000-row, 20-label target of less than two seconds was not met on
bank or adult. The 10,000-row budget was not measured by this matrix.

## MPS limitation

This runtime reports `mps_built=True` and `mps_available=False`. The initial
matrix failed with `RuntimeError: MPS backend is unavailable: no supported Metal
GPU was found`. The final script explicitly checks availability and
`uv run --locked python scripts/bench_teacher.py --device mps` exits 1 with:

```text
MPS is unavailable in this runtime. Rerun on a host with MPS access.
```

MPS timings and the CPU/MPS comparison remain unverified. The default device
remains upstream automatic selection, with `TABSTUDIO_DEVICE` or the adapter's
explicit `device` argument overriding it. No CPU-default decision can be made
from this run. Rerun the matrix on a host exposing MPS before deciding the
Apple Silicon default or recording a comparison in ADR 0003.

## Integration details

- `core/workspace.py` exposes the implemented core APIs so the specified import
  boundary is executable. It imports no teacher implementation or shell library.
- `teachers/checkpoint.py` is shared by the fetch script and runtime adapter;
  neither can silently select an unpinned checkpoint or auto-download fallback.
- `TeacherFrame.frame` keeps source ids and pandas missing values. Datetimes
  become fractional UTC epoch days; only high-cardinality text columns appear
  in `dropped_columns`. Target and explicitly excluded columns are always removed.
- `Proposals` uses source ids for labels, confidence and its probability frame.
  Probability columns follow `teacher.classes`, which may differ from session
  order. Human rows retain their answers with no confidence entry and NaN
  probabilities. Reserved evaluation rows retain internal predictions; the
  presentation layer must hide all `eval_served` rows during blind evaluation.
- `predict_table` returns generation zero. The worker can use
  `dataclasses.replace(proposals, generation=request_generation)` to attach its
  request generation. Progress counts only predicted rows, including reserved
  evaluation rows, and starts at zero. Abstention remains empty until evaluation is implemented.
- `FakeTeacher` lives in `teachers/fake.py`. It reads `TABSTUDIO_FAKE_DELAY_MS`
  at construction and sleeps only in `predict_proba`; call it in the worker
  thread for the planned refit interaction tests.

## Browser computation contract

- `api.worker.RefitWorker` takes a teacher and queues startup warm-up on its
  single executor thread. `ready.result()` exposes startup failures. Warm-up fits
  a 32-row synthetic frame and predicts it to exercise deferred device work;
  it publishes no proposals and does not increment `refit_generation`.
- `refit(table, store)` snapshots the label store and returns a future. Tables
  retain their existing read-only ownership contract. Each request increments
  `refit_generation`; a superseded result returns `None` without publication.
  Successful current results carry their request generation in `proposals`.
  Fitting failures propagate through the future. After a warm-up failure, queued
  refits propagate that failure without fitting or publishing.
- Use the worker as a context manager or call `close()` to drain queued work and
  release its thread. Published proposals remain the last successful result;
  callers can compare their generation with `refit_generation` while refitting.
- Worker tests are marked `native` because their executor and synchronization
  require threads unavailable in the Pyodide unit-test environment.

## MPS matrix (2026-11-05, run outside the sandbox)

Median of five runs after one warm-up, seconds, `--device mps`:

| Dataset | 20 labels | 50 | 100 | 200 |
|---|---|---|---|---|
| bank (5,000 rows) | 2.563 | 2.608 | 2.428 | 2.434 |
| adult (5,000 rows) | 2.424 | 2.425 | 2.464 | 2.615 |

MPS does not close the bank 2-second budget gap; per-call overhead dominates at
this batch size. The budget decision belongs to the `make bench` task, which
rechecks after the distillation path lands.
