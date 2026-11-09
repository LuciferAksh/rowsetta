import asyncio
import os
import socket
import subprocess
import sys
from pathlib import Path

import pytest

from tests.integration.api_support import api
from tests.integration.test_workspace_api import penguins_flow

pytestmark = pytest.mark.native


class UnexpectedNetworkError(AssertionError):
    """The local shell attempted to resolve or connect to an external host."""


def reject_network(*_args: object, **_kwargs: object) -> None:
    message = "The local app must not open network connections."
    raise UnexpectedNetworkError(message)


def test_full_flow_does_not_resolve_or_connect(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("TABSTUDIO_TEACHER", "fake")
    monkeypatch.setattr(socket, "getaddrinfo", reject_network)
    monkeypatch.setattr(socket, "create_connection", reject_network)
    monkeypatch.setattr(socket.socket, "connect", reject_network)
    monkeypatch.setattr(socket.socket, "connect_ex", reject_network)
    monkeypatch.setattr(socket.socket, "sendto", reject_network)

    async def run() -> None:
        async with api(tmp_path) as (_, client):
            await penguins_flow(client)

    asyncio.run(run())


@pytest.mark.parametrize("module", ["tabular_studio.app", "tabular_studio.cli"])
def test_telemetry_and_hub_offline_are_set_before_hub_import(module: str) -> None:

    environment = {
        key: value
        for key, value in os.environ.items()
        if key not in {"HF_HUB_DISABLE_TELEMETRY", "HF_HUB_OFFLINE"}
    }
    subprocess.run(
        [
            sys.executable,
            "-c",
            f"""
import os
import sys
assert 'huggingface_hub' not in sys.modules
import {module}
from huggingface_hub import constants
assert os.environ['HF_HUB_DISABLE_TELEMETRY'] == '1'
assert constants.HF_HUB_DISABLE_TELEMETRY
assert constants.HF_HUB_OFFLINE
""",
        ],
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    )


def test_missing_checkpoint_stays_offline(tmp_path: Path) -> None:

    environment = {key: value for key, value in os.environ.items() if key != "TABSTUDIO_TEACHER"}
    environment["HF_HOME"] = str(tmp_path)
    subprocess.run(
        [
            sys.executable,
            "-c",
            """
import socket
from tabular_studio.app import local_teacher
from tabular_studio.api.errors import ModelUnavailableError

def reject(*args, **kwargs):
    raise AssertionError('Network attempted while resolving missing weights')

socket.getaddrinfo = reject
socket.socket.connect = reject
socket.socket.connect_ex = reject
socket.socket.sendto = reject
try:
    local_teacher()
except ModelUnavailableError as error:
    assert error.next_step == 'tabular-studio doctor --fix'
else:
    raise AssertionError('An empty cache must not provide a teacher')
""",
        ],
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    )
