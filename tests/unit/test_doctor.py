import hashlib
import io
from pathlib import Path

import pytest

from tabular_studio.api.errors import ModelUnavailableError
from tabular_studio.core.errors import UserError
from tabular_studio.doctor import DownloadProgress, doctor
from tabular_studio.teachers import checkpoint

PINNED = b"pinned checkpoint bytes"


class FakeHub:
    """A local cache directory standing in for the pinned hub revision."""

    def __init__(self, cached: Path, *, failure: OSError | None = None) -> None:
        self.cached = cached
        self.failure = failure
        self.downloads = 0

    def try_to_load_from_cache(self, repo_id: str, filename: str, *, revision: str) -> str | None:
        assert (repo_id, filename, revision) == (
            checkpoint.REPO_ID,
            checkpoint.FILENAME,
            checkpoint.REVISION,
        )
        return str(self.cached) if self.cached.exists() else None

    def hf_hub_download(
        self,
        repo_id: str,
        filename: str,
        *,
        revision: str,
        tqdm_class: type[DownloadProgress],
    ) -> str:
        assert (repo_id, filename, revision) == (
            checkpoint.REPO_ID,
            checkpoint.FILENAME,
            checkpoint.REVISION,
        )
        self.downloads += 1
        if self.failure is not None:
            raise self.failure
        progress = tqdm_class(total=len(PINNED), unit="B")
        self.cached.write_bytes(PINNED)
        progress.update(len(PINNED))
        progress.close()
        return str(self.cached)


@pytest.fixture(autouse=True)
def pinned(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(checkpoint, "SHA256", hashlib.sha256(PINNED).hexdigest())
    monkeypatch.setattr(checkpoint, "SIZE_BYTES", len(PINNED))
    monkeypatch.setenv("TABSTUDIO_DEVICE", "cpu")


def test_fix_replaces_a_corrupted_cached_checkpoint(tmp_path: Path) -> None:
    hub = FakeHub(tmp_path / "model.ckpt")
    hub.cached.write_bytes(b"corrupted")
    report = io.StringIO()

    doctor(fix=True, hub=hub, out=report)

    assert hub.cached.read_bytes() == PINNED
    assert hub.downloads == 1
    assert f"sha256      {checkpoint.SHA256} (pinned)" in report.getvalue()


def test_fix_removes_the_corrupted_blob_behind_a_cache_link(tmp_path: Path) -> None:
    blob = tmp_path / "blobs" / "corrupted"
    blob.parent.mkdir()
    blob.write_bytes(b"corrupted")
    hub = FakeHub(tmp_path / "model.ckpt")
    hub.cached.symlink_to(blob)

    doctor(fix=True, hub=hub, out=io.StringIO())

    assert not blob.exists()
    assert hub.cached.read_bytes() == PINNED


def test_report_without_fix_keeps_the_file_and_names_the_repair(tmp_path: Path) -> None:
    hub = FakeHub(tmp_path / "model.ckpt")
    hub.cached.write_bytes(b"corrupted")
    report = io.StringIO()

    with pytest.raises(ModelUnavailableError) as raised:
        doctor(fix=False, hub=hub, out=report)

    assert raised.value.next_step == "tabular-studio doctor --fix"
    assert hub.cached.read_bytes() == b"corrupted"
    assert hub.downloads == 0
    digest = hashlib.sha256(b"corrupted").hexdigest()
    assert f"sha256      {digest} (expected {checkpoint.SHA256})" in report.getvalue()


def test_report_names_the_device_and_a_missing_checkpoint(tmp_path: Path) -> None:
    report = io.StringIO()

    with pytest.raises(ModelUnavailableError):
        doctor(fix=False, hub=FakeHub(tmp_path / "model.ckpt"), out=report)

    lines = report.getvalue().splitlines()
    assert lines[0].startswith("torch       ")
    assert lines[1].startswith("tabicl      ")
    assert lines[2:] == ["device      cpu (TABSTUDIO_DEVICE)", "checkpoint  not downloaded"]


def test_fix_downloads_a_missing_checkpoint(tmp_path: Path) -> None:
    hub = FakeHub(tmp_path / "model.ckpt")

    doctor(fix=True, hub=hub, out=io.StringIO())

    assert hub.cached.read_bytes() == PINNED


def test_fix_keeps_a_verified_checkpoint(tmp_path: Path) -> None:
    hub = FakeHub(tmp_path / "model.ckpt")
    hub.cached.write_bytes(PINNED)

    doctor(fix=True, hub=hub, out=io.StringIO())

    assert hub.downloads == 0


def test_failed_download_names_the_retry(tmp_path: Path) -> None:
    hub = FakeHub(tmp_path / "model.ckpt", failure=ConnectionError("network unreachable"))

    with pytest.raises(UserError) as raised:
        doctor(fix=True, hub=hub, out=io.StringIO())

    assert "network unreachable" in raised.value.what
    assert raised.value.next_step.startswith("tabular-studio doctor --fix")


def test_download_progress_is_one_line_with_bytes_and_percent(
    capsys: pytest.CaptureFixture[str],
) -> None:
    progress = DownloadProgress(total=2_000_000, unit="B")
    progress.update(500_000)
    progress.update(1_500_000)
    progress.close()

    assert capsys.readouterr().err == (
        f"Downloading {checkpoint.FILENAME}: 2,000,000 of 2,000,000 bytes (100%)\n"
    )
