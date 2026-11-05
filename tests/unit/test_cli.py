import os
import subprocess
import sys

import pytest

pytestmark = pytest.mark.native


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


def test_unknown_option_fails_with_usage() -> None:
    result = subprocess.run(
        [sys.executable, "-m", "tabular_studio", "--unknown"],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 2
    assert "unrecognized arguments: --unknown" in result.stderr
