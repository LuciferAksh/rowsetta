import hashlib
from pathlib import Path
from typing import Protocol

import huggingface_hub


class ModelHub(Protocol):
    """The download interface needed for a pinned checkpoint, without dry-run results."""

    def hf_hub_download(self, repo_id: str, filename: str, *, revision: str) -> str:
        """Return the cached path for a file at an immutable revision."""
        ...


REPO_ID = "jingang/TabICL"
FILENAME = "tabicl-classifier-v2-20260212.ckpt"
REVISION = "4dcd344ece2c00be9e831fdd35bed57b5ad83e19"
SHA256 = "bdc7dbd5e4ff21f8f0456fcf90c6b7cdf72dbea960f2d05b19bec19f9b3d4ed0"
SIZE_BYTES = 110_368_038
CHECKSUM_ERROR = (
    "checkpoint checksum mismatch; delete ~/.cache/huggingface/hub/models--jingang--TabICL "
    "and retry"
)


def verify_checkpoint(path: Path) -> None:
    """Remove a corrupt checkpoint before it can be passed to a teacher."""
    with path.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    if digest != SHA256 or path.stat().st_size != SIZE_BYTES:
        path.unlink()
        raise SystemExit(CHECKSUM_ERROR)


def main(hub: ModelHub = huggingface_hub) -> None:
    """Fetch the pinned public checkpoint and print its verified location."""
    path = Path(hub.hf_hub_download(repo_id=REPO_ID, filename=FILENAME, revision=REVISION))
    verify_checkpoint(path)
    print(f"{FILENAME}: {SHA256} ({path.stat().st_size} bytes)")
    print(path)


if __name__ == "__main__":
    main()
