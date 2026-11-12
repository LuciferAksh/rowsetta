import os
import subprocess
import sys
from pathlib import Path
from time import perf_counter

import pytest

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
