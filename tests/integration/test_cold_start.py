import json
import os
import subprocess
import sys
from pathlib import Path
from time import perf_counter
from types import SimpleNamespace

import pytest

from scripts import cold_start
from scripts.cold_start import COLD_BUDGET_SECONDS, Timing, drive, over_budget, wait_healthy

pytestmark = pytest.mark.native

PORT = 8796
LAUNCH_CODE = "cold-start-test-token"


def test_drive_labels_six_rows_and_waits_for_first_proposals(tmp_path: Path) -> None:
    server = subprocess.Popen(
        [sys.executable, "-m", "rowsetta", "demo", "--no-browser", "--port", str(PORT)],
        env={
            **os.environ,
            "ROWSETTA_TEACHER": "fake",
            "ROWSETTA_SESSION_TOKEN": LAUNCH_CODE,
            "HOME": str(tmp_path),
        },
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        started = perf_counter()
        wait_healthy(PORT, timeout=60)
        timing = drive(PORT, LAUNCH_CODE, started=started)
    finally:
        server.terminate()
        server.wait(timeout=30)
    assert 0 <= timing.health_seconds <= timing.first_proposals_seconds


@pytest.mark.parametrize(
    ("seconds", "warm", "over"),
    [
        (COLD_BUDGET_SECONDS, False, False),
        (COLD_BUDGET_SECONDS + 1, False, True),
        (COLD_BUDGET_SECONDS, True, True),
    ],
)
def test_budgets(seconds: float, *, warm: bool, over: bool) -> None:
    assert over_budget(Timing(health_seconds=1, first_proposals_seconds=seconds), warm=warm) == over


@pytest.mark.parametrize(
    ("timing", "over"),
    [
        (("cold", 10, 30), False),
        (("cold", 11, 20), True),
        (("warm", 1, 6), False),
        (("warm", 1, 7), True),
    ],
)
def test_browser_budgets_are_distinct_from_local_install_budgets(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    timing: tuple[str, float, float],
    *,
    over: bool,
) -> None:
    visit, table_seconds, proposal_seconds = timing

    def run(command: list[str], *, cwd: Path, check: bool) -> None:
        assert cwd == cold_start.ROOT
        assert check
        Path(command[-1]).write_text(
            json.dumps(
                [
                    {
                        "visit": visit,
                        "table_seconds": table_seconds,
                        "first_proposals_seconds": proposal_seconds,
                        "bytes": 42,
                    }
                ]
            )
        )

    monkeypatch.setattr(cold_start, "subprocess", SimpleNamespace(run=run))
    monkeypatch.setattr(cold_start, "BENCH_JSON", tmp_path / "bench.json")
    if over:
        with pytest.raises(SystemExit, match="Browser"):
            cold_start.run_browser("http://127.0.0.1:4173/", no_budget=False)
    else:
        cold_start.run_browser("http://127.0.0.1:4173/", no_budget=False)
