import json
from pathlib import Path

import pytest

from rowsetta.browser_shell import (
    BROWSER_MAX_BYTES,
    BrowserRequest,
    BrowserShell,
    browser_metadata,
    within_browser_fit_limit,
)
from rowsetta.core.lite_teacher import LiteTeacher


@pytest.fixture
def shell() -> BrowserShell:
    shell = BrowserShell(LiteTeacher(), browser_metadata("2026-11-11"))
    path = Path(__file__).resolve().parents[2] / "src/rowsetta/datasets/penguins.csv"
    shell.workspace.load(path.read_bytes(), path.name, max_rows=2000)
    shell.workspace.set_target("species", ("Adelie", "Chinstrap", "Gentoo"))
    return shell


def test_full_model_fit_limit_boundary() -> None:
    assert within_browser_fit_limit(1250, 16)
    assert not within_browser_fit_limit(1251, 16)
    assert not within_browser_fit_limit(1, 101)
    assert not within_browser_fit_limit(-1, 2)


def test_browser_masks_target_and_eval_rows(shell: BrowserShell) -> None:
    state = shell.state()
    assert state["human"] == {}
    rows = shell.workspace.require_table().frame.groupby("species").groups
    for label, ids in rows.items():
        for row in ids[:2]:
            shell.execute(BrowserRequest(action="label", row=int(row), label=str(label)))
    assert shell.workspace.proposals is not None
    reserved = shell.workspace.next_eval()
    public = shell.state()
    proposals = public["proposals"]
    assert isinstance(proposals, dict)
    assert reserved not in proposals
    page = shell.table_page(0, 100)
    assert '"species": null' in json.dumps(page)
    generation = shell.workspace.generation
    shell.execute(BrowserRequest(action="undo"))
    assert shell.workspace.generation > generation
    assert shell.workspace.proposals is None


def test_browser_sql_certificate_names_the_actual_teacher(shell: BrowserShell) -> None:
    rows = shell.workspace.require_table().frame.groupby("species").groups
    for label, ids in rows.items():
        for row in ids[:2]:
            shell.workspace.set_label(int(row), str(label), "human")
    shell.refit()
    shell.execute(BrowserRequest(action="distill"))
    sql = shell.execute(BrowserRequest(action="export"))
    assert isinstance(sql, str)
    assert "lite model (random forest), not TabICLv2" in sql
    assert "not executed" in sql.lower()
    assert "browser demo" in sql
    assert 'AS "predicted_species"' in sql


def test_browser_rejects_column_prefill_and_invalid_label(shell: BrowserShell) -> None:
    response = json.loads(shell.call('{"action":"target","target":"species","classes":[]}'))
    assert response["ok"] is False
    assert "local-app feature" in response["error"]["error"]
    response = json.loads(shell.call('{"action":"label","row":99999,"label":"Adelie"}'))
    assert response["ok"] is False
    assert shell.workspace.max_bytes == BROWSER_MAX_BYTES
