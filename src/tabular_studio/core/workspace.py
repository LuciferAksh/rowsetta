from dataclasses import dataclass, replace
from datetime import date
from typing import Literal

import numpy as np

from tabular_studio.core.active import Predictions, next_row
from tabular_studio.core.distill import (
    InsufficientFoldSupportError,
    Student,
    compare_on_eval,
    direct_trees,
    eval_accuracy,
    fidelity_cross_fitted,
    fidelity_in_sample,
    fit_student,
    teacher_eval_accuracy,
)
from tabular_studio.core.errors import (
    BadCsvError,
    FileTooLargeError,
    NeedLabelsError,
    TooManyColumnsError,
    WorkspaceError,
)
from tabular_studio.core.evaluation import EvalResult, evaluate
from tabular_studio.core.export.sql import Certificate, ColumnType, NotExecuted
from tabular_studio.core.features import TeacherFrame, teacher_frame
from tabular_studio.core.session import LabelStore, SourceRef
from tabular_studio.core.table import Table, load_csv
from tabular_studio.core.teacher import MIN_LABELS_PER_CLASS, Proposals, Teacher, predict_table

__all__ = [
    "ExportMetadata",
    "LabelStore",
    "Proposals",
    "SourceRef",
    "Table",
    "Teacher",
    "TeacherFrame",
    "Workspace",
    "load_csv",
    "predict_table",
    "teacher_frame",
]


@dataclass(frozen=True)
class ExportMetadata:
    """Shell-supplied provenance, keeping clock and package lookups out of core."""

    export_date: date
    tool_version: str
    teacher_version: str
    checkpoint_sha256: str


class Workspace:
    """Own one table and invalidate derived results whenever session inputs change."""

    def __init__(self) -> None:
        self.table: Table | None = None
        self.source: SourceRef | None = None
        self.data = b""
        self.store: LabelStore | None = None
        self.proposals: Proposals | None = None
        self.student: Student | None = None
        self.generation = 0

    def load(self, data: bytes, file_name: str, *, max_rows: int) -> None:
        """Replace the table only after CSV validation succeeds."""
        try:
            table = load_csv(data, max_rows=max_rows)
        except BadCsvError as error:
            raise BadCsvError(error.reason, error.line_number, file_name=file_name) from error
        except FileTooLargeError as error:
            raise FileTooLargeError(
                error.size_bytes, error.max_bytes, file_name=file_name
            ) from error
        except TooManyColumnsError as error:
            raise TooManyColumnsError(
                error.column_names,
                error.max_columns,
                file_name=file_name,
            ) from error
        self.source = SourceRef.from_table(file_name, data, table)
        self.table, self.data, self.store = table, data, None
        self.invalidate()

    def set_target(self, target: str, classes: tuple[str, ...]) -> None:
        """Start a new label store; existing target values never become training labels."""
        table = self.require_table()
        if target not in table.frame:
            msg = "The target column does not exist."
            raise WorkspaceError(msg, status_code=422)
        if self.source is None:
            msg = "Load a CSV before selecting a target."
            raise WorkspaceError(msg)
        store = LabelStore(target=target, classes=classes, source=self.source)
        self._require_features(table, store)
        self.store = store
        self.invalidate()

    def set_label(self, row: int, label: str | None, mode: Literal["human", "eval"]) -> None:
        """Validate an edit and keep evaluation rows out of human training."""
        store = self.require_store()
        if row not in store.source.row_ids() or (label is not None and label not in store.classes):
            msg = "Use a source row id and one of the configured classes."
            raise WorkspaceError(msg, status_code=422)
        if mode == "human":
            store.set_human(row, label)
        else:
            store.set_eval(row, label)
        self.invalidate()

    def undo(self) -> int | None:
        """Undo through the store and discard predictions based on the reverted edit."""
        row = self.require_store().undo()
        self.invalidate()
        return row

    def next_eval(self) -> int | None:
        """Reserve a random row before exposing it for blind evaluation."""
        store = self.require_store()
        before = tuple(store.eval_served)
        row = store.next_eval_row()
        if before != tuple(store.eval_served):
            self.student = None
        return row

    def exclude(self, name: str, *, excluded: bool) -> None:
        """Reject exclusions that would leave the model without usable features."""
        table, store = self.require_table(), self.require_store()
        if name not in table.frame or name == store.target:
            msg = "Choose a feature column to exclude."
            raise WorkspaceError(msg, status_code=422)
        columns = store.excluded_columns | {name} if excluded else store.excluded_columns - {name}
        candidate = store.model_copy(update={"excluded_columns": frozenset(columns)})
        self._require_features(table, candidate)
        store.excluded_columns = frozenset(columns)
        self.invalidate()

    def set_threshold(self, threshold: float) -> None:
        """Invalidate teacher abstention and the rule together."""
        self.require_store().threshold = threshold
        self.invalidate()

    def invalidate(self) -> None:
        """Supersede in-flight generations and discard stale derived data."""
        self.generation += 1
        self.proposals = None
        self.student = None

    def missing_labels(self) -> dict[str, int]:
        """Return the human labels still needed before proposals can start."""
        store = self.require_store()
        labels = list(store.human.values())
        return {
            label: MIN_LABELS_PER_CLASS - labels.count(label)
            for label in store.classes
            if labels.count(label) < MIN_LABELS_PER_CLASS
        }

    def publish(self, proposals: Proposals, generation: int) -> bool:
        """Accept predictions only if no newer edit has superseded their inputs."""
        if generation != self.generation:
            return False
        self.proposals = replace(proposals, generation=generation)
        return True

    def require_table(self) -> Table:
        """Require loaded data at the orchestration boundary."""
        if self.table is None:
            msg = "No CSV is loaded."
            raise WorkspaceError(msg)
        return self.table

    def require_store(self) -> LabelStore:
        """Require an explicit target and class vocabulary before labelling."""
        if self.store is None:
            msg = "Choose a target and its classes first."
            raise WorkspaceError(msg)
        return self.store

    def require_proposals(self) -> Proposals:
        """Distinguish missing human labels from an unfinished refit."""
        missing = self.missing_labels()
        if missing:
            raise NeedLabelsError(missing)
        if self.proposals is None:
            msg = "The latest refit has not finished."
            raise WorkspaceError(msg)
        return self.proposals

    def distill(self, max_depth: int) -> Student:
        """Fit a rule using current proposals and human labels, reserving eval rows."""
        self.student = fit_student(
            self.require_table(),
            self.require_store(),
            self.require_proposals(),
            max_depth=max_depth,
        )
        return self.student

    def next_human(self) -> int | None:
        """Select an eligible row without letting active selection touch eval rows."""
        store = self.require_store()
        rows = [
            row
            for row in store.source.row_ids()
            if row not in store.human and row not in store.eval_served
        ]
        if not rows:
            return None
        if self.proposals is None:
            return rows[0]
        probabilities = self.proposals.proba
        return next_row(
            Predictions(
                probabilities.to_numpy(), list(probabilities.index), tuple(probabilities.columns)
            ),
            store,
            pick_index=len(store.human),
            rng=np.random.default_rng(store.eval_seed),
        )

    def evaluation(self) -> EvalResult | None:
        """Measure raw teacher answers independently of the display threshold."""
        if self.store is None or self.proposals is None:
            return None
        raw_labels = dict(self.proposals.label)
        for row in self.store.eval:
            raw_labels[row] = str(self.proposals.proba.loc[row].idxmax())
        return evaluate(self.store, replace(self.proposals, label=raw_labels))

    def certificate(self, metadata: ExportMetadata) -> Certificate:
        """Measure the current rule without inventing missing evaluation evidence."""
        table, store, proposals = (
            self.require_table(),
            self.require_store(),
            self.require_proposals(),
        )
        student = self.student
        if student is None:
            msg = "Distil the current rule before exporting."
            raise WorkspaceError(msg)
        try:
            cross_fitted = fidelity_cross_fitted(student, store, proposals)
            direct = direct_trees(table, store, settings=student.settings)
        except InsufficientFoldSupportError as error:
            raise WorkspaceError(error.what, error.next_step) from error
        columns = tuple(
            _column_type(name, str(table.frame[name].dtype)) for name in table.frame.columns
        )
        return Certificate(
            tool_name="Tabular Studio (working title)",
            tool_version=metadata.tool_version,
            export_date=metadata.export_date,
            row_count=table.source_rows,
            columns=columns,
            target=store.target,
            classes=store.classes,
            tree_depth=student.tree.get_depth(),
            tree_leaves=student.tree.get_n_leaves(),
            in_sample=fidelity_in_sample(student, store, proposals),
            cross_fitted=cross_fitted,
            rule_accuracy=eval_accuracy(student, store),
            teacher_accuracy=teacher_eval_accuracy(proposals, store),
            direct_same_accuracy=direct.same_settings.accuracy,
            direct_tuned_accuracy=direct.tuned.accuracy,
            comparison=compare_on_eval(student, direct.tuned.student, store),
            abstention_threshold=store.threshold,
            tabicl_version=metadata.teacher_version,
            checkpoint_sha256=metadata.checkpoint_sha256,
            execution=NotExecuted("verification pending"),
        )

    @staticmethod
    def _require_features(table: Table, store: LabelStore) -> None:
        try:
            teacher_frame(table, store)
        except ValueError as error:
            raise WorkspaceError(str(error), status_code=422) from error


def _column_type(name: str, source_type: str) -> ColumnType:
    if source_type.startswith(("int", "uint", "float")):
        return ColumnType(name, source_type, "DOUBLE", "DOUBLE PRECISION", "REAL")
    return ColumnType(name, source_type, "VARCHAR", "TEXT", "TEXT")
