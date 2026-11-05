"""dbt model and data tests, with coverage drift measured against the certificate."""

import json
import re
from fractions import Fraction

from tabular_studio.core.distill import Student
from tabular_studio.core.export.sql import Certificate, Dialect, to_sql

COVERAGE_DRIFT_MARGIN = 0.10


def to_dbt(
    student: Student, *, source: str, certificate: Certificate, dialect: Dialect = "duckdb"
) -> dict[str, str]:
    """Return relative project paths and contents for an existing dbt source model.

    Resource names must be plain dbt identifiers. The caller writes these files
    into its project; no profiles, credentials or data enter the export.
    """
    for name in (source, certificate.target):
        if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name) is None:
            message = f"Use a dbt identifier containing letters, digits and underscores: {name!r}"
            raise ValueError(message)
    coverage = certificate.in_sample.coverage
    if coverage.total <= 0 or not 0 <= coverage.answered <= coverage.total:
        message = "dbt coverage drift requires certificate coverage with a positive total."
        raise ValueError(message)
    model = certificate.target + "_rule"
    prediction = "predicted_" + certificate.target
    sql = to_sql(student, dialect=dialect, table_name=source, certificate=certificate)
    suffix = f' FROM "{source}";\n'
    sql = sql.removesuffix(suffix) + f" FROM {{{{ ref('{source}') }}}}\n"
    schema = {
        "version": 2,
        "models": [
            {
                "name": model,
                "columns": [
                    {
                        "name": prediction,
                        "data_tests": [
                            {
                                "accepted_values": {
                                    "arguments": {
                                        # dbt's macro quotes values without escaping apostrophes.
                                        "values": [
                                            label.replace("'", "''")
                                            for label in certificate.classes
                                        ],
                                        "quote": True,
                                    }
                                }
                            }
                        ],
                    }
                ],
            }
        ],
    }
    # JSON is a YAML subset and preserves class names without YAML coercion.
    schema_yaml = json.dumps(schema, ensure_ascii=False, indent=2) + "\n"
    limit = Fraction(coverage.total - coverage.answered, coverage.total) + Fraction(
        str(COVERAGE_DRIFT_MARGIN)
    )
    # Cross multiplication preserves the strict boundary without float rounding.
    coverage_sql = "".join(
        (
            f"-- NULL share limit: (1 - {coverage.answered}/{coverage.total})",
            f" + {COVERAGE_DRIFT_MARGIN!r}\n",
            "SELECT null_count, row_count\nFROM (\n",
            '    SELECT SUM(CASE WHEN "',
            prediction,
            '" IS NULL THEN 1 ELSE 0 END) AS null_count, COUNT(*) AS row_count\n',
            "    FROM {{ ref('",
            model,
            "') }}\n",
            ") AS coverage\nWHERE null_count * ",
            str(limit.denominator),
            " > row_count * ",
            str(limit.numerator),
            "\n",
        )
    )
    return {
        f"models/{model}.sql": sql,
        "models/schema.yml": schema_yaml,
        f"tests/{model}_coverage.sql": coverage_sql,
    }
