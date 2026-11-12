# Show HN: Rowsetta - label a few rows, keep a SQL rule

Rowsetta is a local tool for labelling a CSV and exporting a decision tree as
SQL, dbt, Python or JSON. It suggests labels, lets you review possible mistakes
and measures the rule on held-out rows.

The audit is a way to find rows worth checking, not proof that a label is wrong.
The committed benchmark results are smoke runs; the full comparison against
simple tree baselines is still outstanding. Feedback on the labelling flow and
the exported rules would be useful.
