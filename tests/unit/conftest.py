import sys

# These modules import native shells or their fixtures at collection time.
# Deselection with `-m not native` happens too late to prevent those imports.
collect_ignore = (
    [
        "test_bench_audit.py",
        "test_bench_pipeline.py",
        "test_bench_schema.py",
        "test_datasets.py",
        "test_dbt.py",
        "test_doctor.py",
        "test_exports.py",
        "test_sql.py",
        "test_sql_boundary.py",
        "test_tabicl_adapter.py",
        "test_teacher_bench.py",
    ]
    if sys.platform == "emscripten"
    else []
)
