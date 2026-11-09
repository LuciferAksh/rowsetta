import json
import tempfile
from pathlib import Path

from tabular_studio.api.security import SessionSecurity
from tabular_studio.app import create_app
from tabular_studio.teachers.fake import FakeTeacher


def openapi_document() -> str:
    """Render the HTTP contract the frontend types are checked against, as stable JSON."""
    with tempfile.TemporaryDirectory() as scratch:
        app = create_app(
            teacher=FakeTeacher(),
            security=SessionSecurity("openapi-export"),
            static_dir=Path(scratch) / "static",
            data_dir=Path(scratch) / "sessions",
        )
        return json.dumps(app.openapi(), indent=2, sort_keys=True)


def main() -> None:
    """Print the schema; the committed copy lives at frontend/tests/openapi.json."""
    print(openapi_document())


if __name__ == "__main__":
    main()
