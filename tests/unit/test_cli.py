import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

pytestmark = pytest.mark.native

ROOT = Path(__file__).resolve().parents[2]
SESSION = Path("tests/fixtures/penguins.tabstudio.json")
DATASET = ROOT / "src/tabular_studio/datasets/penguins.csv"


def run_cli(*args: str, cwd: Path = ROOT) -> subprocess.CompletedProcess[str]:
    environment = {**os.environ, "TABSTUDIO_TEACHER": "fake", "NO_COLOR": "1"}
    return subprocess.run(
        [sys.executable, "-m", "tabular_studio", *args],
        capture_output=True,
        text=True,
        check=False,
        cwd=cwd,
        env=environment,
    )


def assert_user_error(
    result: subprocess.CompletedProcess[str], *, what: str, next_step: str
) -> None:
    assert result.returncode == 1
    assert result.stdout == ""
    error, recovery = result.stderr.splitlines()
    assert error.startswith("error: ")
    assert what in error
    assert recovery.startswith("Next: tabular-studio ")
    assert next_step in recovery


def test_help_requires_no_credentials() -> None:
    environment = {key: value for key, value in os.environ.items() if key != "HF_TOKEN"}
    result = subprocess.run(
        [sys.executable, "-m", "tabular_studio", "--help"],
        capture_output=True,
        text=True,
        check=True,
        env=environment,
    )

    assert "usage: tabular-studio" in result.stdout
    assert "working title" in result.stdout
    assert result.stderr == ""


def test_help_lists_the_four_commands() -> None:
    result = run_cli("--help")

    assert result.returncode == 0
    assert "{open,demo,export,doctor}" in result.stdout


def test_unknown_option_fails_with_usage() -> None:
    result = subprocess.run(
        [sys.executable, "-m", "tabular_studio", "--unknown"],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 2
    assert "unrecognized arguments: --unknown" in result.stderr


@pytest.mark.parametrize(
    "args",
    [
        ("open", "data.csv", "--max-file-mb", "0"),
        ("open", "data.csv", "--max-file-mb", "-3"),
        ("open", "data.csv", "--columns", ""),
        ("open", "data.csv", "--columns", "species,,island"),
        ("demo", "iris"),
        ("export", str(SESSION), "--format", "csv"),
        ("export", str(SESSION), "--dialect", "mysql"),
    ],
)
def test_invalid_options_are_usage_errors(args: tuple[str, ...]) -> None:
    result = run_cli(*args)

    assert result.returncode == 2
    assert "usage: tabular-studio" in result.stderr


def test_export_writes_verified_sql_for_the_saved_session() -> None:
    result = run_cli("export", str(SESSION), "--format", "sql", "--dialect", "duckdb")

    assert result.returncode == 0, result.stderr
    assert result.stdout.startswith("-- ")
    assert "344/344 rows identical" in result.stdout
    assert 'AS "predicted_species"' in result.stdout


@pytest.mark.parametrize(
    ("export_format", "marker"),
    [("python", "def predict("), ("json", '"identical": 344'), ("dbt", "models/species_rule.sql")],
)
def test_export_writes_every_format(export_format: str, marker: str) -> None:
    result = run_cli("export", str(SESSION), "--format", export_format, "--dialect", "duckdb")

    assert result.returncode == 0, result.stderr
    assert marker in result.stdout


def test_dbt_export_is_a_json_map_of_project_files() -> None:
    result = run_cli("export", str(SESSION), "--format", "dbt", "--dialect", "sqlite")

    files = json.loads(result.stdout)
    assert set(files) == {
        "models/species_rule.sql",
        "models/schema.yml",
        "tests/species_rule_coverage.sql",
    }
    assert "344/344 rows identical" in files["models/species_rule.sql"]


def write_session(directory: Path, source: bytes) -> Path:
    (directory / "penguins.csv").write_bytes(source)
    session = json.loads((ROOT / SESSION).read_text())
    session["source"]["file_name"] = "penguins.csv"
    path = directory / "penguins.tabstudio.json"
    path.write_text(json.dumps(session))
    return path


def test_export_resolves_the_csv_beside_the_session(tmp_path: Path) -> None:
    session = write_session(tmp_path, DATASET.read_bytes())

    result = run_cli("export", session.name, cwd=tmp_path)

    assert result.returncode == 0, result.stderr
    assert "344/344 rows identical" in result.stdout


def test_export_rejects_a_changed_csv(tmp_path: Path) -> None:
    session = write_session(tmp_path, DATASET.read_bytes().replace(b"Torgersen", b"Torgersem", 1))

    assert_user_error(
        run_cli("export", str(session)),
        what="changed since",
        next_step=f"open {tmp_path / 'penguins.csv'}",
    )


def test_export_names_a_missing_csv(tmp_path: Path) -> None:
    session = write_session(tmp_path, b"")
    (tmp_path / "penguins.csv").unlink()

    assert_user_error(
        run_cli("export", str(session)),
        what=str(tmp_path / "penguins.csv"),
        next_step="export",
    )


def test_export_rejects_an_invalid_session(tmp_path: Path) -> None:
    session = tmp_path / "broken.tabstudio.json"
    session.write_text('{"human": {}}')

    assert_user_error(
        run_cli("export", str(session)), what="broken.tabstudio.json", next_step="open"
    )


def test_export_names_a_missing_session(tmp_path: Path) -> None:
    assert_user_error(
        run_cli("export", "absent.tabstudio.json", cwd=tmp_path),
        what="absent.tabstudio.json",
        next_step="export",
    )


def test_open_rejects_a_file_over_the_raised_limit_before_reading_it(tmp_path: Path) -> None:
    large = tmp_path / "large.csv"
    large.write_bytes(b"x\n" + b"1\n" * 500_001)

    assert_user_error(
        run_cli("open", "large.csv", "--max-file-mb", "1", "--no-browser", cwd=tmp_path),
        what="the limit is 1 MB",
        next_step="open large.csv --max-file-mb 2",
    )


def test_open_names_a_missing_file(tmp_path: Path) -> None:
    assert_user_error(
        run_cli("open", "absent.csv", "--no-browser", cwd=tmp_path),
        what="absent.csv",
        next_step="open",
    )


def test_open_rejects_unknown_columns_with_a_runnable_selection(tmp_path: Path) -> None:
    (tmp_path / "data.csv").write_text("species,island\nAdelie,Dream\n")

    assert_user_error(
        run_cli("open", "data.csv", "--columns", "species,isle", "--no-browser", cwd=tmp_path),
        what="`isle`",
        next_step="open data.csv --columns species,island",
    )
