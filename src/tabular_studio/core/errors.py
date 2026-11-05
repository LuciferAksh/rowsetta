import shlex
from decimal import Decimal

BYTES_PER_MB = 1_000_000


class UserError(Exception):
    """An expected failure with an explanation and a concrete recovery step."""

    what: str
    next_step: str

    def __init__(self, what: str, next_step: str) -> None:
        self.what = what
        self.next_step = next_step
        super().__init__(what)


class FileTooLargeError(UserError):
    """The input exceeds the caller's byte budget before any parsing occurs."""

    def __init__(self, size_bytes: int, max_bytes: int, *, file_name: str = "data.csv") -> None:
        self.size_bytes = size_bytes
        self.max_bytes = max_bytes
        self.file_name = file_name
        size_mb = Decimal(size_bytes) / BYTES_PER_MB
        limit_mb = Decimal(max_bytes) / BYTES_PER_MB
        super().__init__(
            f"`{file_name}` is {size_mb:f} MB; the limit is {limit_mb:f} MB "
            "(50 MB in the browser).",
            shlex.join(
                [
                    "tabular-studio",
                    "open",
                    file_name,
                    "--max-file-mb",
                    str((size_bytes + BYTES_PER_MB - 1) // BYTES_PER_MB),
                ]
            ),
        )


class TooManyColumnsError(UserError):
    """The input needs an explicit column selection to fit the model."""

    def __init__(
        self, column_names: tuple[str, ...], max_columns: int, *, file_name: str = "data.csv"
    ) -> None:
        self.column_names = column_names
        self.max_columns = max_columns
        self.file_name = file_name
        super().__init__(
            f"`{file_name}` has {len(column_names)} columns; "
            f"the model takes at most {max_columns}.",
            shlex.join(
                [
                    "tabular-studio",
                    "open",
                    file_name,
                    "--columns",
                    ",".join(column_names[:max_columns]),
                ]
            ),
        )


class BadCsvError(UserError):
    """The input could not be decoded or parsed as supported CSV."""

    def __init__(self, reason: str, line_number: int, *, file_name: str = "data.csv") -> None:
        self.reason = reason
        self.line_number = line_number
        self.file_name = file_name
        super().__init__(
            f"Could not read `{file_name}`: {reason} (line {line_number}).",
            f"{shlex.join(['iconv', '-f', 'WINDOWS-1252', '-t', 'UTF-8', file_name])} "
            f"> {shlex.quote(file_name + '.utf8.csv')}. "
            "Save it as UTF-8 CSV with a comma, semicolon or tab separator, then run "
            f"`{shlex.join(['tabular-studio', 'open', file_name])}`",
        )
