import importlib
import os
import sys
from importlib.metadata import version
from pathlib import Path
from typing import Protocol, TextIO, override

import huggingface_hub
from huggingface_hub import constants
from huggingface_hub.utils import tqdm

from tabular_studio.api.errors import ModelUnavailableError
from tabular_studio.core.errors import UserError
from tabular_studio.teachers import checkpoint

LABEL_WIDTH = 12


class DownloadProgress(tqdm):
    """One line with bytes and percent: rewritten on a terminal, printed once in logs."""

    @override
    def display(self, msg: str | None = None, pos: int | None = None) -> None:
        """Write the progress line; tqdm adds the final newline when the download closes."""
        terminal = sys.stderr.isatty()
        # tqdm passes pos=0 only from close(), so logs get the finished count alone.
        if not terminal and pos != 0:
            return
        done, total = int(self.n), int(self.total or 0)
        percent = done * 100 // total if total else 0
        prefix = "\r" if terminal else ""
        sys.stderr.write(
            f"{prefix}Downloading {checkpoint.FILENAME}: {done:,} of {total:,} bytes ({percent}%)"
        )


class CheckpointHub(Protocol):
    """The hub's offline cache lookup and its pinned download."""

    def try_to_load_from_cache(self, repo_id: str, filename: str, *, revision: str) -> object:
        """Return the cached path as a string; any other value means it is absent."""
        ...

    def hf_hub_download(
        self,
        repo_id: str,
        filename: str,
        *,
        revision: str,
        tqdm_class: type[DownloadProgress],
    ) -> str:
        """Download the file at an immutable revision and return its cached path."""
        ...


def doctor(*, fix: bool, hub: CheckpointHub = huggingface_hub, out: TextIO = sys.stdout) -> None:
    """Report the model runtime and checkpoint, replacing a bad checkpoint when asked.

    Raises ModelUnavailableError when the checkpoint is still missing or corrupt.
    """
    cached = _cached(hub)
    if fix and (cached is None or not checkpoint.is_pinned(*cached)):
        if cached is not None:
            # The hub cache links the file name to a content blob; both must go.
            cached[0].resolve().unlink()
            cached[0].unlink(missing_ok=True)
        cached = _download(hub)
    rows = [("torch", version("torch")), ("tabicl", version("tabicl")), ("device", _device())]
    if cached is None:
        rows.append(("checkpoint", "not downloaded"))
    else:
        path, digest = cached
        status = "pinned" if checkpoint.is_pinned(path, digest) else f"expected {checkpoint.SHA256}"
        rows += [("checkpoint", str(path)), ("sha256", f"{digest} ({status})")]
    out.write("".join(f"{label:<{LABEL_WIDTH}}{value}\n" for label, value in rows))
    if cached is None or not checkpoint.is_pinned(*cached):
        raise ModelUnavailableError


def _cached(hub: CheckpointHub) -> tuple[Path, str] | None:
    found = hub.try_to_load_from_cache(
        checkpoint.REPO_ID, checkpoint.FILENAME, revision=checkpoint.REVISION
    )
    if not isinstance(found, str):
        return None
    return Path(found), checkpoint.file_sha256(Path(found))


def _download(hub: CheckpointHub) -> tuple[Path, str]:
    offline = constants.HF_HUB_OFFLINE
    # The app turns the hub offline at import; this repair is the one download the user requests.
    constants.HF_HUB_OFFLINE = False
    try:
        path = Path(
            hub.hf_hub_download(
                checkpoint.REPO_ID,
                checkpoint.FILENAME,
                revision=checkpoint.REVISION,
                tqdm_class=DownloadProgress,
            )
        )
    except OSError as error:
        message = f"Could not download the model: {error}"
        raise UserError(
            message, "tabular-studio doctor --fix once the network is reachable"
        ) from error
    finally:
        constants.HF_HUB_OFFLINE = offline
    return path, checkpoint.file_sha256(path)


def _device() -> str:
    requested = os.environ.get("TABSTUDIO_DEVICE") or None
    # tabicl resolves device=None with this function, so the report matches what a refit uses.
    devices = importlib.import_module("tabicl._torch_devices")
    resolved = str(devices.resolve_torch_device(requested))
    return f"{resolved} (TABSTUDIO_DEVICE)" if requested else f"{resolved} (automatic)"
