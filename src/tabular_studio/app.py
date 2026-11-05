import os

os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["HF_HUB_OFFLINE"] = "1"

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException

from tabular_studio.api.errors import (
    ApiError,
    FrontendMissingError,
    ModelUnavailableError,
    error_body,
    error_status,
)
from tabular_studio.api.routes import workspace_router
from tabular_studio.api.runtime import WorkspaceRuntime
from tabular_studio.api.security import (
    ALLOWED_HOSTS,
    ErrorContractMiddleware,
    SessionMiddleware,
    SessionSecurity,
)
from tabular_studio.core.errors import UserError
from tabular_studio.core.table import MAX_ROWS
from tabular_studio.core.teacher import Teacher
from tabular_studio.core.workspace import Workspace
from tabular_studio.teachers.fake import FakeTeacher
from tabular_studio.teachers.tabicl import TabICLTeacher


def create_app(
    *,
    teacher: Teacher,
    security: SessionSecurity,
    static_dir: Path | None = None,
) -> FastAPI:
    """Build an isolated local app whose teacher and session belong to one launch."""
    workspace = Workspace()
    runtime = WorkspaceRuntime(workspace, teacher)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncGenerator[None]:
        try:
            yield
        finally:
            await runtime.close()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(SessionMiddleware, security=security)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=ALLOWED_HOSTS)
    app.add_middleware(ErrorContractMiddleware)

    @app.exception_handler(UserError)
    async def user_error(_request: Request, error: UserError) -> JSONResponse:
        return JSONResponse(error_body(error), status_code=error_status(error))

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_request: Request, _error: RequestValidationError) -> JSONResponse:
        error = ApiError("The request fields are invalid.", status_code=422)
        return JSONResponse(error_body(error), status_code=422)

    @app.exception_handler(HTTPException)
    async def http_error(_request: Request, error: HTTPException) -> JSONResponse:
        if (
            isinstance(error.detail, dict)
            and "error" in error.detail
            and "next_step" in error.detail
        ):
            return JSONResponse(error.detail, status_code=error.status_code)
        failure = ApiError(str(error.detail), status_code=error.status_code)
        return JSONResponse(error_body(failure), status_code=error.status_code)

    @app.get("/health")
    async def health() -> dict[str, bool]:
        return {"ok": True}

    static = static_dir if static_dir is not None else Path(__file__).parent / "static"

    @app.get("/")
    async def index() -> Response:
        if not (static / "index.html").is_file():
            raise FrontendMissingError
        return FileResponse(static / "index.html")

    app.include_router(
        workspace_router(
            runtime,
            max_rows=int(os.environ.get("TABSTUDIO_MAX_ROWS", str(MAX_ROWS))),
            dev_states=os.environ.get("TABSTUDIO_STATES") == "1",
        )
    )
    if (static / "index.html").is_file():
        app.mount("/", StaticFiles(directory=static, html=True))
    return app


def local_teacher() -> Teacher:
    """Choose explicit test inference or verified local weights without egress."""
    if os.environ.get("TABSTUDIO_TEACHER") == "fake":
        return FakeTeacher()
    try:
        return TabICLTeacher()
    except (OSError, RuntimeError, SystemExit) as error:
        raise ModelUnavailableError from error
