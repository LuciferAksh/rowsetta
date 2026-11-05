# Acquisition and table loading findings

Status: acquisition and table loading accepted locally on 2026-11-05. Both fetch scripts ran;
source and checkpoint hashes matched the pinned values. `make check` passed.

## Dependency and tooling decisions

| Plan reference   | Public exception name |
| ---------------- | --------------------- |
| `FileTooLarge`   | `FileTooLargeError`   |
| `TooManyColumns` | `TooManyColumnsError` |
| `BadCsv`         | `BadCsvError`         |

There are no aliases. Later implementations referring to these names must import the
names above. The names satisfy Ruff N818 without exclusions.

Every CLI-facing `next_step` starts with a named executable command. When a fix
happens outside the product, prepend the smallest concrete external command and
retain the actionable error sentence after it. `BadCsvError` starts with
`iconv -f WINDOWS-1252 -t UTF-8 data.csv > data.csv.utf8.csv`, then keeps the
sentence beginning "Save it as UTF-8 CSV". WINDOWS-1252 is a concrete conversion
example; replace it with the actual source encoding. Conversion writes a
separate file. Save the corrected CSV under the original name before running
the preserved open command. Encoding conversion alone cannot repair malformed
CSV records; those still need correction or re-export as the sentence directs.
File and output names are shell-quoted.

Added only the authorized development dependency `pandas-stubs==3.1.0.261029`.
[PyPI metadata](https://pypi.org/pypi/pandas-stubs/json) reported this as the
latest stable release on 2026-11-05. Its documented version policy recommends
matching pandas major/minor versions; these stubs target pandas 3.1.0 and match
the installed pandas 3.1.1 major/minor. Strict pyright reports no errors or
warnings. No checker setting, lint exclusion or test threshold was changed.

Hypothesis's pandas `data_frames` signature contains unparameterized dictionaries.
The property test now draws typed mixed rows and builds an object DataFrame,
retaining arbitrary integers, floats, booleans, missing cells and Unicode strings,
including empty frames. It still checks CSV shape and column-name round trips.
The Hub 2.4.0 download overload has incomplete annotations for unused optional
arguments. `ModelHub` describes the exact public download subset used here; the
module is checked against that protocol at the `main` parameter. No casts or
untyped dynamic lookups are used.

## Acquisition and provenance

`scripts/fetch_model.py` calls `hf_hub_download` with repository `jingang/TabICL`,
filename `tabicl-classifier-v2-20260212.ckpt` and immutable revision
`4dcd344ece2c00be9e831fdd35bed57b5ad83e19`. The actual download verified:

```text
SHA-256 bdc7dbd5e4ff21f8f0456fcf90c6b7cdf72dbea960f2d05b19bec19f9b3d4ed0
110368038 bytes
```

A hash or size mismatch deletes the downloaded path and exits 1 with the initial configuration's
checksum-mismatch text. Verification ran on macOS without credentials, with
`HF_HOME=/private/tmp/tabular-studio-huggingface`; the verified file is under
`hub/models--jingang--TabICL/snapshots/<revision>/` there. Later teacher work must
reuse that cache setting or rerun the fetch script. No inference was requested
or tested in these tasks.

`scripts/fetch_datasets.py` checks all three source hashes before writing data.
The destination is `src/tabular_studio/datasets/`, as section 5 specifies.
The full [packaged cards](../src/tabular_studio/datasets/CARDS.md) hold source
URLs, hashes, citations, licences, modifications and the `duration` leakage note;
[datasets/CARDS.md](../datasets/CARDS.md) indexes them from the task's named path.
Penguins is unchanged, including `NA`. Bank comes from nested `bank.zip` and
`bank-full.csv`, retaining `duration`. Adult uses `adult.data` with headers read
from `adult.names`, spaces after delimiters stripped, and `?` mapped to empty.

Stratification allocates exact class row counts by largest remainder, breaking
ties by sorted class label. Each class is sampled with pandas seed 7 and source
order restored. Each browser sample is drawn from its corresponding local file,
using seed 7 again. Tests verify row counts, subset membership, deterministic
browser sampling, and a maximum 0.5 percentage-point class-share difference.

| File           | Rows  | Columns | Class shares              |
| -------------- | ----- | ------- | ------------------------- |
| `penguins.csv` | 344   | 8       | Source unchanged          |
| `bank.csv`     | 5,000 | 17      | no 88.3%, yes 11.7%       |
| `bank_2k.csv`  | 2,000 | 17      | no 88.3%, yes 11.7%       |
| `adult.csv`    | 5,000 | 15      | <=50K 75.92%, >50K 24.08% |
| `adult_2k.csv` | 2,000 | 15      | <=50K 75.9%, >50K 24.1%   |

The maximum browser/local class-share difference is zero for Bank and 0.02
percentage points for Adult. Both are below the required 0.5 points.

| Bundled file   | SHA-256                                                            |
| -------------- | ------------------------------------------------------------------ |
| `penguins.csv` | `f204db2c753b0937caac3cb35258562c14f073e4bbc76be24b4c51ce22767a93` |
| `bank.csv`     | `298e92bcbc42bd68855b2447bb13fb96b9ca7274b213b80b58691b862f313ed5` |
| `bank_2k.csv`  | `f8831cac119bdad84438d4a14595a132cbd32a4873c9676e02e9dcdaa86bfa2d` |
| `adult.csv`    | `7ed85bcb2a8dcab3c8f73431b5a9d9d61c7dcb81fa534feb911384e252aa61e6` |
| `adult_2k.csv` | `968e35c053f86616c3102248fb1c2e2c1ad8f3a041359dc057738d345948e953` |

## Table loading

- `load_csv` reads bytes only and reports `data.csv` because its planned signature
  has no file name argument. Error constructors accept `file_name` for later shells.
- File limits are checked before decoding. Decimal MB use 1,000,000 bytes;
  recovery budgets round up to a whole MB without rounding the reported size.
- Sampling uses seed 7, preserves original indices and precedes kind inference.
  Distinct and missing ratios use the number of kept rows as their denominator.
  Missing values do not count toward distinct values or datetime parse success.
- Boolean columns, including boolean columns with missing cells, become lowercase
  categorical strings. Numeric columns retain their parsed values. Date inference
  describes the column without converting its values.
- A UTF-8 code point may straddle the 65,536-byte sniff window. An incremental
  decoder permits that boundary without accepting invalid bytes within the window.
- When sniffing the window fails, the loader tries its header and then a comma
  for single-column input. pandas rejects malformed records during parsing.
- pandas can interpret surplus fields in the first data row as an implicit index.
  The loader rejects that case to preserve original zero-based row identities.
- `Table` is frozen but its pandas frame remains mutable. Callers must treat the
  frame as read-only.
- Recovery commands quote file names and column arguments with `shlex.join`.
  How the future CLI represents column names containing commas remains unverified.

The demo acceptance test checks every column's expected kind for all three local
files. Penguins has five numeric and three categorical columns; Bank has seven
numeric and ten categorical columns; Adult has six numeric and nine categorical
columns. The test includes filesystem reads and asserts each load takes under 1 s.

`uv run --locked python scripts/bench_table.py` measured the real files on this
Mac, including filesystem reads, CSV parsing and inference, with no model load:

```text
penguins.csv: 344 rows, 8 columns, 0.002107 s
bank.csv: 5000 rows, 17 columns, 0.005636 s
adult.csv: 5000 rows, 15 columns, 0.005489 s
bank_2k.csv: 2000 rows, 17 columns, 0.004176 s
adult_2k.csv: 2000 rows, 15 columns, 0.003990 s
```

These are local single-run observations, not a cold-install or portable latency
claim. The table tests also cover separator and BOM handling, seeded 10,001-row
sampling, limits and recovery text, inference thresholds, the 100-column fixture
with long names and Unicode, and the deterministic Hypothesis round trip.

## Verification on 2026-11-05

Commands used `UV_CACHE_DIR=/private/tmp/tabular-studio-uv-cache` because the
default uv cache is outside the writable sandbox.

Both `uv run --locked python scripts/fetch_datasets.py` and
`HF_HOME=/private/tmp/tabular-studio-huggingface uv run --locked python scripts/fetch_model.py`
exited 0. All download hashes matched section 5; dataset output ended with:

```text
bank.csv: 5000 rows
bank_2k.csv: 2000 rows
adult.csv: 5000 rows
adult_2k.csv: 2000 rows
```

`uv run --locked pytest -m 'not model and not pg'` exited 0:

```text
..................................................                       [100%]
50 passed in 0.49s
```

`make check` exited 0. Ruff formatting and lint passed, pyright reported
`0 errors, 0 warnings, 0 informations`, all 50 Python tests passed, and frontend
formatting, lint and type checks passed. The final output ended with:

```text
 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  03:15:12
   Duration  122ms (transform 57%, import 37%, worker 3%, tests 2%)
```

No plan files were edited. No commits or remote operations were performed.
