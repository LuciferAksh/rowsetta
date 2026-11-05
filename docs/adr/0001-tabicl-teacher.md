# 0001: TabICLv2 as the teacher

Status: accepted design; first-day API verification complete.

## Installed API verification

On 2026-11-05, `tabicl` 2.2.0 from the locked environment exposed all constructor
parameters required by the model runtime. The command exited 0:

```sh
uv run python -c "import tabicl, inspect; print(inspect.signature(tabicl.TabICLClassifier))"
```

Relevant fields from the printed signature:

```text
n_estimators: int = 8
kv_cache: bool | str = False
model_path: Optional[str | Path] = None
device: Optional[str | torch.device] = None
checkpoint_version: str = 'tabicl-classifier-v2-20260212.ckpt'
```

This confirms the adapter's planned arguments, not teacher latency, parity or
KV-cache performance. Those remain their own model acceptance checks.

## Optional TabPFN v2 benchmark

The baseline explicitly calls
`TabPFNClassifier.create_default_for_version(ModelVersion.V2)` so that a changed
default cannot silently select a gated model. It imports TabPFN only when the
benchmark is run. The initial implementation covers only the smoke; full benchmark cells belong
to the full benchmark.

On 2026-11-05 the locked TabPFN 9.2.0 completed local CPU inference without a
token or login. Twenty complete penguins rows supply labels and ten disjoint
rows form the smoke evaluation. Both benchmark smoke scripts use the same
seed-7 split. This smoke is an execution check, not a benchmark estimate.

```sh
env -u TABPFN_TOKEN uv run --group bench python scripts/bench_baseline_tabpfn.py --model v2 --smoke
```

```text
TabPFN v2: labels=20 rows=10 accuracy=1.000000 seconds=8.279573 TABPFN_TOKEN=unset
```

Exit status: 0. No manual account step is needed for this v2 path. Later model
versions and their access terms were not tested.

The final script was rerun against the now-cached v2 weights, again exiting 0:

```text
TabPFN v2: labels=20 rows=10 accuracy=1.000000 seconds=0.182649 TABPFN_TOKEN=unset
```

These timings have different cache states and are not benchmark comparisons.

The sandbox run relocated the uv, Hugging Face, model, matplotlib and skrub
caches with `UV_CACHE_DIR`, `HF_HOME`, `TABPFN_MODEL_CACHE_DIR`, `MPLCONFIGDIR`
and `SKB_DATA_DIRECTORY`, respectively, to directories beneath `/private/tmp/`.
The initial skrub import failed trying to create `~/skrub_data`; setting its
documented `SKB_DATA_DIRECTORY` resolved that filesystem restriction. No
package versions, credentials, fit inputs or model selection were changed.
