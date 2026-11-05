"""SQL export route for a shell-supplied snapshot of the current rule."""

from collections.abc import Callable
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse, Response

from tabular_studio.api.sql_check import sql_check
from tabular_studio.core.distill import Student
from tabular_studio.core.errors import UserError
from tabular_studio.core.export.sql import Certificate, Dialect, NotExecuted, to_sql


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
