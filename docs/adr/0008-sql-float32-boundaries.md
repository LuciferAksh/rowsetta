# 0008: SQL boundaries and supported feature types

Status: accepted for SQL export.

scikit-learn casts tree inputs to float32 before comparing them with a float64
threshold. Comparing the original SQL value directly with that threshold can
send boundary rows to the wrong leaf.

For each numeric split, find the largest float32 `g` not above the threshold
and its next float32 neighbour `h`. Emit the exact float64 midpoint
`m = (g + h) / 2`, printed with `repr(float(m))`. Use `<= m` when `g` has an
even significand and `< m` otherwise, preserving round-half-to-even ties.
The shared `split_condition` function supplies these literals to both SQL and
leaf summaries. Source numeric columns must retain float64 precision. Missing
cells are SQL NULL and follow the tree's `missing_go_to_left` routing.

The exporter supports numeric and one-hot categorical splits. A used datetime split
raises `UnsupportedDatetimeSplitError`, names its column, and supplies a
command-first recovery step to exclude the column and re-teach without it.
Unused datetime features do not block export. Portable datetime parsing is
not implemented in this change.

`tree_to_sql` groups optional table naming, leaf labels and certificate facts
in frozen `SqlOptions`. Required feature specification, target and dialect stay
keyword arguments. This decision supersedes the initial literal
signature to meet the argument-count lint bar.

The shell verifies header-less DuckDB SQL against every source row before
returning an export in any supported dialect. A mismatch returns HTTP 500 with
the first source row id and a recovery step, logs the failure, and withholds SQL.
The SQL router accepts a shell-owned export context; workspace selection and
application authentication remain integration work.
