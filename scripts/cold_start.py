import sys
from pathlib import Path

if __package__ is None:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import argparse
import json
import os
import platform
import secrets
import subprocess
import tempfile
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from http import HTTPStatus
from http.cookiejar import CookieJar
from time import perf_counter, sleep
from urllib.error import HTTPError, URLError
from urllib.request import HTTPCookieProcessor, ProxyHandler, Request, build_opener

import pandas as pd

from scripts.bench_common import BENCH_JSON, DOCUMENT, JSON, ROOT, atomic_json, provenance

# Time to first proposals on the bundled penguins, from a cold or a warm cache.
COLD_BUDGET_SECONDS = 180
WARM_BUDGET_SECONDS = 15
PORT = 8787
POLL_SECONDS = 0.2
PENGUINS = ROOT / "src/rowsetta/datasets/penguins.csv"
LABELS_PER_SPECIES = 2  # The fewest that start proposals.


@dataclass(frozen=True)
class Timing:
    """Seconds from launch to each milestone."""

    health_seconds: float
    first_proposals_seconds: float


def over_budget(timing: Timing, *, warm: bool) -> bool:
    """Compare first proposals with the cold or warm budget."""
    budget = WARM_BUDGET_SECONDS if warm else COLD_BUDGET_SECONDS
    return timing.first_proposals_seconds > budget


def wait_healthy(port: int, *, timeout: float) -> float:
    """Poll /health without a proxy until it answers; return the seconds waited."""
    opener = build_opener(ProxyHandler({}))
    start = perf_counter()
    while perf_counter() - start < timeout:
        try:
            with opener.open(f"http://127.0.0.1:{port}/health", timeout=5) as response:
                if json.load(response).get("ok") is True:
                    return perf_counter() - start
        except (URLError, ConnectionError):
            sleep(POLL_SECONDS)
    message = f"Port {port} /health did not answer within {timeout:.0f} s"
    raise TimeoutError(message)


def drive(port: int, token: str, *, started: float) -> Timing:
    """Label six penguins through the API and wait for the refit that answers them."""
    opener = build_opener(ProxyHandler({}), HTTPCookieProcessor(CookieJar()))

    def call(method: str, path: str, body: object | None = None) -> dict[str, object]:
        data = None if body is None else json.dumps(body).encode()
        request = Request(f"http://127.0.0.1:{port}{path}", data=data, method=method)
        request.add_header("Content-Type", "application/json")
        with opener.open(request, timeout=30) as response:
            return json.load(response)

    health = perf_counter() - started
    try:
        opener.open(f"http://127.0.0.1:{port}/?token={token}", timeout=30).close()
    except HTTPError as error:
        # The redirect target is the page, absent from a source install without a build.
        if error.code != HTTPStatus.SERVICE_UNAVAILABLE:
            raise
    species = pd.read_csv(PENGUINS)["species"]
    call("POST", "/target", {"target": "species", "classes": sorted(species.unique())})
    for label, rows in species.groupby(species).groups.items():
        for row in rows[:LABELS_PER_SPECIES]:
            call("PUT", f"/labels/{row}", {"label": label, "mode": "human"})
    while True:
        state = call("GET", "/state")
        if state["failure"] is not None:
            message = f"Refit failed: {state['failure']}"
            raise RuntimeError(message)
        if state["refit_generation"] == state["generation"] and state["proposals"]:
            return Timing(health, perf_counter() - started)
        sleep(POLL_SECONDS)


def du_bytes(*folders: Path) -> int:
    """Count bytes the install wrote, the download size on a clean cache."""
    return sum(
        path.stat().st_size for folder in folders for path in folder.rglob("*") if path.is_file()
    )


def run_local(spec: str, caches: Path) -> Timing:
    """Start `uvx SPEC demo` on the given caches and time it to first proposals."""
    token = secrets.token_urlsafe(16)
    env = {
        **os.environ,
        "UV_CACHE_DIR": str(caches / "uv"),
        "UV_TOOL_DIR": str(caches / "tools"),
        "HF_HOME": str(caches / "hf"),
        "ROWSETTA_SESSION_TOKEN": token,
    }
    backend: list[str] = ["--torch-backend", "cpu"] if sys.platform == "linux" else []
    command = ["uvx", *backend, spec, "demo", "--no-browser", "--port", str(PORT)]
    started = perf_counter()
    server = subprocess.Popen(command, env=env, stdout=subprocess.DEVNULL)  # noqa: S603
    try:
        wait_healthy(PORT, timeout=COLD_BUDGET_SECONDS * 2)
        return drive(PORT, token, started=started)
    finally:
        server.terminate()
        server.wait(timeout=30)


def main() -> None:
    """Measure cold and warm local time to demo and record it in docs/bench.json."""
    cli = argparse.ArgumentParser(description="Time from a clean install to first proposals")
    cli.add_argument("--local", required=True, metavar="SPEC", help="for example rowsetta@0.1.0")
    cli.add_argument("--no-budget", action="store_true", help="measure without asserting budgets")
    args = cli.parse_args()
    with tempfile.TemporaryDirectory(prefix="rowsetta-cold-") as folder:
        caches = Path(folder)
        cold = run_local(args.local, caches)
        downloaded = du_bytes(caches / "uv", caches / "tools", caches / "hf")
        warm = run_local(args.local, caches)
    section = provenance(
        "scripts/cold_start.py",
        cold.first_proposals_seconds + warm.first_proposals_seconds,
        {
            "spec": args.local,
            "date": datetime.now(UTC).date().isoformat(),
            "machine": platform.node(),
        },
    )
    section.results = [
        {"visit": "cold", **asdict(cold), "bytes": downloaded},
        {"visit": "warm", **asdict(warm)},
    ]
    document = DOCUMENT.validate_json(BENCH_JSON.read_text()) if BENCH_JSON.exists() else {}
    existing = document.get("cold_start")
    cold_start = existing if isinstance(existing, dict) else {}
    cold_start["local"] = JSON.validate_python(section.model_dump(mode="json"))
    document["cold_start"] = cold_start
    atomic_json(BENCH_JSON, document)
    print(f"cold_start local cold={cold} warm={warm} bytes={downloaded}", flush=True)
    if not args.no_budget and (over_budget(cold, warm=False) or over_budget(warm, warm=True)):
        sys.exit(f"Over budget: cold {COLD_BUDGET_SECONDS} s, warm {WARM_BUDGET_SECONDS} s")


if __name__ == "__main__":
    main()
