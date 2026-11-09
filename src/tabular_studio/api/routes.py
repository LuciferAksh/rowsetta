"""SQL export route for a shell-supplied snapshot of the current rule."""

from collections.abc import Callable
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import JsonValue, TypeAdapter

from tabular_studio.api.errors import ApiError
from tabular_studio.api.presentation import event_stream, export_metadata, workspace_state
from tabular_studio.api.runtime import WorkspaceRuntime
from tabular_studio.api.schemas import (
    DistillInput,
    ExclusionInput,
    LabelInput,
    TargetInput,
    ThresholdInput,
)
from tabular_studio.api.sql_check import sql_check, sql_check_data
from tabular_studio.api.upload import table_upload
from tabular_studio.core.distill import Student, leaf_summary
from tabular_studio.core.errors import UserError, WorkspaceError
from tabular_studio.core.export.dbt import to_dbt
from tabular_studio.core.export.json import to_json
from tabular_studio.core.export.python import to_python
from tabular_studio.core.export.sql import Certificate, Dialect, NotExecuted, to_sql
from tabular_studio.core.leaks import find_leaks
from tabular_studio.core.workspace import Workspace

type ExportFormat = Literal["sql", "dbt", "python", "json"]
EXPORT_MEDIA_TYPES: dict[ExportFormat, str] = {
    "sql": "application/sql",
    "python": "text/x-python",
    "json": "application/json",
}


@dataclass(frozen=True)
class SqlExportContext:
    """The source file and immutable rule facts selected by the shell."""

    source: Path
    student: Student
    certificate: Certificate


def sql_export_router(current_export: Callable[[], SqlExportContext]) -> APIRouter:
    """Build the export route without owning workspace state or authentication."""
    router = APIRouter()

    @router.get("/export")
    def export_sql(
        _export_format: Annotated[Literal["sql"], Query(alias="format")] = "sql",
        dialect: Dialect = "duckdb",
    ) -> Response:
        context = current_export()
        facts = replace(context.certificate, execution=NotExecuted("verification pending"))
        try:
            checked_sql = to_sql(context.student, dialect="duckdb", certificate=facts)
            headerless = checked_sql.removeprefix(facts.header())
            execution = sql_check(
                context.source, context.student, target=facts.target, sql=headerless
            )
            result = to_sql(
                context.student, dialect=dialect, certificate=replace(facts, execution=execution)
            )
        except UserError as error:
            return JSONResponse(
                status_code=422, content={"error": error.what, "next_step": error.next_step}
            )
        except HTTPException as error:
            return JSONResponse(status_code=error.status_code, content=error.detail)
        return Response(content=result, media_type="application/sql")

    return router


def workspace_router(runtime: WorkspaceRuntime, *, max_rows: int, dev_states: bool) -> APIRouter:
    """Assemble the table, labelling, inspection and export HTTP surfaces."""
    router = APIRouter()
    router.include_router(table_router(runtime, max_rows=max_rows, dev_states=dev_states))
    router.include_router(label_router(runtime, dev_states=dev_states))
    router.include_router(inspection_router(runtime, dev_states=dev_states))
    router.include_router(workspace_export_router(runtime))
    return router


def mutation_result(runtime: WorkspaceRuntime, *, dev_states: bool) -> dict[str, object]:
    """Queue current inputs before returning the public state."""
    runtime.schedule()
    return workspace_state(runtime, dev_states=dev_states)


def table_router(runtime: WorkspaceRuntime, *, max_rows: int, dev_states: bool) -> APIRouter:
    """Load and page source rows and declare the target."""
    router = APIRouter()
    workspace = runtime.workspace

    @router.post("/table")
    async def load_table(request: Request) -> dict[str, object]:
        data, name = await table_upload(request)
        workspace.load(data, name, max_rows=max_rows)
        return mutation_result(runtime, dev_states=dev_states)

    @router.get("/table")
    async def page_table(
        page: Annotated[int, Query(ge=0)] = 0,
        size: Annotated[int, Query(ge=1, le=1000)] = 100,
    ) -> dict[str, object]:
        table = workspace.require_table()
        frame = table.frame.iloc[page * size : (page + 1) * size].copy()
        if workspace.store is not None:
            frame[workspace.store.target] = None
        rows = TypeAdapter(list[dict[str, JsonValue]]).validate_json(
            frame.to_json(orient="records")
        )
        return {
            "rows": rows,
            "row_ids": list(frame.index),
            "columns": table.columns,
            "total": len(table.frame),
            "source_rows": table.source_rows,
            "page": page,
            "size": size,
        }

    @router.post("/target")
    async def target(body: TargetInput) -> dict[str, object]:
        workspace.set_target(body.target, body.classes)
        return mutation_result(runtime, dev_states=dev_states)

    return router


def label_router(runtime: WorkspaceRuntime, *, dev_states: bool) -> APIRouter:
    """Edit labels and model inputs while preserving blind evaluation."""
    router = APIRouter()
    workspace = runtime.workspace

    @router.put("/labels/{row_id}")
    async def label(row_id: int, body: LabelInput) -> dict[str, object]:
        workspace.set_label(row_id, body.label, body.mode)
        return mutation_result(runtime, dev_states=dev_states)

    @router.post("/undo")
    async def undo() -> dict[str, object]:
        workspace.undo()
        return mutation_result(runtime, dev_states=dev_states)

    @router.get("/eval/next")
    async def eval_next() -> dict[str, object]:
        return {"row_id": workspace.next_eval()}

    @router.put("/columns/{name}/excluded")
    async def exclusion(name: str, body: ExclusionInput) -> dict[str, object]:
        workspace.exclude(name, excluded=body.excluded)
        return mutation_result(runtime, dev_states=dev_states)

    @router.put("/threshold")
    async def threshold(body: ThresholdInput) -> dict[str, object]:
        workspace.set_threshold(body.threshold)
        return mutation_result(runtime, dev_states=dev_states)

    return router


def inspection_router(runtime: WorkspaceRuntime, *, dev_states: bool) -> APIRouter:
    """Expose current state, measurements, sessions and refit events."""
    router = APIRouter()
    workspace = runtime.workspace

    @router.get("/state")
    async def get_state() -> dict[str, object]:
        return workspace_state(runtime, dev_states=dev_states)

    @router.post("/distill")
    async def distill(body: DistillInput) -> dict[str, object]:
        if runtime.failure is not None:
            raise runtime.failure
        student = workspace.distill(body.max_depth)
        return {
            "leaf_summary": leaf_summary(student, workspace.require_table().frame),
            "generation": workspace.generation,
        }

    @router.get("/audit")
    async def audit() -> dict[str, object]:
        return {"leaks": find_leaks(workspace.require_table(), workspace.require_store())}

    @router.get("/session")
    async def session() -> Response:
        return Response(workspace.require_store().to_json(), media_type="application/json")

    @router.get("/events")
    async def events() -> StreamingResponse:
        return StreamingResponse(
            event_stream(runtime),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    return router


def workspace_export_router(runtime: WorkspaceRuntime) -> APIRouter:
    """Export the current rule with measured provenance and full-source SQL identity."""
    router = APIRouter()
    workspace = runtime.workspace

    @router.get("/export")
    async def export(
        export_format: Annotated[ExportFormat, Query(alias="format")] = "sql",
        dialect: Dialect = "duckdb",
    ) -> Response:
        if runtime.failure is not None:
            raise runtime.failure
        artifact = export_artifact(
            workspace, fake=runtime.fake_teacher, export_format=export_format, dialect=dialect
        )
        if isinstance(artifact, dict):
            return JSONResponse(artifact)
        return Response(artifact, media_type=EXPORT_MEDIA_TYPES[export_format])

    return router


def export_artifact(
    workspace: Workspace, *, fake: bool, export_format: ExportFormat, dialect: Dialect
) -> str | dict[str, str]:
    """Render the current rule after proving its SQL on every source row.

    dbt exports are project-relative paths mapped to file contents.
    """
    facts = workspace.certificate(export_metadata(fake=fake))
    student = workspace.student
    if student is None:
        msg = "Distil the current rule before exporting."
        raise WorkspaceError(msg)
    checked = to_sql(student, dialect="duckdb", certificate=facts).removeprefix(facts.header())
    execution = sql_check_data(workspace.data, student, target=facts.target, sql=checked)
    facts = replace(facts, execution=execution)
    if export_format == "python":
        return facts.header().replace("-- ", "# ") + to_python(student)
    if export_format == "json":
        return to_json(student, certificate=facts)
    if export_format == "dbt":
        try:
            return to_dbt(student, source="source_data", certificate=facts, dialect=dialect)
        except ValueError as error:
            raise ApiError(str(error), status_code=422) from error
    return to_sql(student, dialect=dialect, certificate=facts)
