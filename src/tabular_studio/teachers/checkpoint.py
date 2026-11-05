import hashlib
from pathlib import Path
from typing import Protocol

import huggingface_hub

REPO_ID = "jingang/TabICL"
FILENAME = "tabicl-classifier-v2-20260212.ckpt"
REVISION = "4dcd344ece2c00be9e831fdd35bed57b5ad83e19"
SHA256 = "bdc7dbd5e4ff21f8f0456fcf90c6b7cdf72dbea960f2d05b19bec19f9b3d4ed0"
SIZE_BYTES = 110_368_038
CHECKSUM_ERROR = (
    "checkpoint checksum mismatch; delete ~/.cache/huggingface/hub/models--jingang--TabICL "
    "and retry"
)


class ModelHub(Protocol):
    """Pinned file download without the hub's alternate dry-run result type."""

    def hf_hub_download(self, repo_id: str, filename: str, *, revision: str) -> str:
        """Return a cached file at an immutable revision."""
        ...


def verify_checkpoint(path: Path) -> None:
    """Remove corrupt weights before loading them into the model."""
    with path.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    if digest != SHA256 or path.stat().st_size != SIZE_BYTES:
        path.unlink()
        raise SystemExit(CHECKSUM_ERROR)


def checkpoint_path(hub: ModelHub = huggingface_hub) -> Path:
    """Resolve and verify the public checkpoint from the pinned revision."""
    path = Path(hub.hf_hub_download(repo_id=REPO_ID, filename=FILENAME, revision=REVISION))
    verify_checkpoint(path)
    return path
