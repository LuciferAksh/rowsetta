"""Package only the browser core and pinned runtime, never local model/server code."""

import hashlib
import json
import shutil
from pathlib import Path
from urllib.request import urlopen
from zipfile import ZIP_DEFLATED, ZipFile

from rowsetta.browser_shell import BrowserShell, browser_metadata
from rowsetta.core.lite_teacher import LiteTeacher

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "frontend/public/browser"
RUNTIME_VERSION = "314.0.7"
PACKAGES = ("numpy", "pandas", "scipy", "scikit-learn", "pydantic", "micropip")
WHEEL = "rowsetta_browser_core-0.1.0-py3-none-any.whl"


def package_core() -> None:
    """Build a pure wheel without invoking the full application's frontend hook."""
    package = ROOT / "src/rowsetta"
    files = [
        package / "__init__.py",
        package / "browser_shell.py",
        *sorted((package / "core").rglob("*.py")),
    ]
    with ZipFile(PUBLIC / WHEEL, "w", ZIP_DEFLATED) as wheel:
        for path in files:
            wheel.write(path, path.relative_to(ROOT / "src"))
        metadata = "rowsetta_browser_core-0.1.0.dist-info"
        for name in ("LICENSE", "NOTICE"):
            wheel.write(ROOT / name, f"{metadata}/licenses/{name}")
        wheel.writestr(
            f"{metadata}/METADATA",
            "Metadata-Version: 2.1\nName: rowsetta-browser-core\nVersion: 0.1.0\n",
        )
        wheel.writestr(
            f"{metadata}/WHEEL", "Wheel-Version: 1.0\nRoot-Is-Purelib: true\nTag: py3-none-any\n"
        )
        wheel.writestr(f"{metadata}/RECORD", "")


def main() -> None:
    """Stage a self-contained runtime so visitor data never needs a remote service."""
    PUBLIC.mkdir(parents=True, exist_ok=True)
    package_core()
    runtime = ROOT / "frontend/node_modules/pyodide"
    lock = json.loads((runtime / "pyodide-lock.json").read_text())
    selected: set[str] = set()

    def include(name: str) -> None:
        name = name.replace("_", "-")
        if name in selected:
            return
        selected.add(name)
        for dependency in lock["packages"][name]["depends"]:
            include(dependency)

    for package in PACKAGES:
        include(package)
    destination = PUBLIC / "runtime"
    destination.mkdir(exist_ok=True)
    for name in (
        "pyodide.mjs",
        "pyodide.asm.mjs",
        "pyodide.asm.wasm",
        "python_stdlib.zip",
        "pyodide-lock.json",
    ):
        shutil.copyfile(runtime / name, destination / name)
    for name in sorted(selected):
        entry = lock["packages"][name]
        path = runtime / entry["file_name"]
        if not path.exists():
            with urlopen(
                f"https://cdn.jsdelivr.net/pyodide/v{RUNTIME_VERSION}/full/{path.name}"
            ) as response:
                data = response.read()
            if hashlib.sha256(data).hexdigest() != entry["sha256"]:
                msg = f"Runtime checksum mismatch: {name}"
                raise ValueError(msg)
            path.write_bytes(data)
        if hashlib.sha256(path.read_bytes()).hexdigest() != entry["sha256"]:
            msg = f"Runtime checksum mismatch: {path}"
            raise ValueError(msg)
        shutil.copyfile(path, destination / path.name)
    shutil.copyfile(ROOT / "src/rowsetta/datasets/penguins.csv", PUBLIC / "penguins.csv")
    shell = BrowserShell(LiteTeacher(), browser_metadata("2026-11-11"))
    shell.workspace.load((PUBLIC / "penguins.csv").read_bytes(), "penguins.csv", max_rows=2000)
    shell.workspace.set_target("species", ("Adelie", "Chinstrap", "Gentoo"))
    (PUBLIC / "demo.json").write_text(
        json.dumps({"state": shell.state(), "table": shell.table_page(0, 1000)})
    )
    manifest = {
        str(path.relative_to(PUBLIC)): {
            "bytes": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        }
        for path in sorted(PUBLIC.rglob("*"))
        if path.is_file() and path.name not in ("manifest.json", "demo.json")
    }
    (PUBLIC / "manifest.json").write_text(json.dumps(manifest))
    total = sum(path.stat().st_size for path in PUBLIC.rglob("*") if path.is_file())
    print(f"Browser runtime and core: {total} bytes")


if __name__ == "__main__":
    main()
