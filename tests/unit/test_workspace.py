import pytest

from tabular_studio.core.errors import NeedLabelsError, WorkspaceError
from tabular_studio.core.teacher import predict_table
from tabular_studio.core.workspace import Workspace
from tabular_studio.teachers.fake import FakeTeacher


@pytest.fixture
def workspace() -> Workspace:
    workspace = Workspace()
    data = b"x,answer\n" + b"".join(
        f"{row},{'a' if row < 20 else 'b'}\n".encode() for row in range(40)
    )
    workspace.load(data, "source.csv", max_rows=40)
    workspace.set_target("answer", ("a", "b"))
    for row, label in ((0, "a"), (1, "a"), (38, "b"), (39, "b")):
        workspace.set_label(row, label, "human")
    return workspace


def refit(workspace: Workspace) -> None:
    result = predict_table(FakeTeacher(), workspace.require_table(), workspace.require_store())
    assert workspace.publish(result, workspace.generation)


def test_target_values_are_not_training_labels_and_invalid_target_is_atomic(
    workspace: Workspace,
) -> None:
    assert workspace.require_store().human == {0: "a", 1: "a", 38: "b", 39: "b"}
    before = workspace.require_store().to_json()
    with pytest.raises(WorkspaceError, match="does not exist"):
        workspace.set_target("missing", ("a", "b"))
    assert workspace.require_store().to_json() == before


def test_last_feature_cannot_be_excluded(workspace: Workspace) -> None:
    with pytest.raises(WorkspaceError, match="No usable features"):
        workspace.exclude("x", excluded=True)
    assert workspace.require_store().excluded_columns == frozenset()


def test_stale_generation_cannot_publish_after_labels_are_cleared(workspace: Workspace) -> None:
    result = predict_table(FakeTeacher(), workspace.require_table(), workspace.require_store())
    generation = workspace.generation
    workspace.set_label(0, None, "human")
    assert workspace.missing_labels() == {"a": 1}
    assert not workspace.publish(result, generation)
    assert workspace.proposals is None
    with pytest.raises(NeedLabelsError) as failure:
        workspace.distill(4)
    assert failure.value.missing == {"a": 1}


def test_table_replacement_invalidates_session_and_in_flight_results(workspace: Workspace) -> None:
    result = predict_table(FakeTeacher(), workspace.require_table(), workspace.require_store())
    generation = workspace.generation
    workspace.load(b"number,outcome\n1,a\n2,b\n", "new.csv", max_rows=40)
    assert not workspace.publish(result, generation)
    assert workspace.store is None
    assert workspace.source is not None
    assert workspace.source.file_name == "new.csv"


def test_serving_eval_after_distillation_invalidates_the_student(workspace: Workspace) -> None:
    refit(workspace)
    workspace.distill(4)
    row = workspace.next_eval()
    assert row is not None
    assert workspace.student is None
    assert row != workspace.next_human()
    student = workspace.distill(4)
    assert row not in student.teacher_labels
    assert row in student.eval_rows


def test_raw_evaluation_is_independent_of_abstention(workspace: Workspace) -> None:
    for _ in range(20):
        row = workspace.next_eval()
        assert row is not None
        workspace.set_label(row, "a" if row < 20 else "b", "eval")
    refit(workspace)
    original = workspace.evaluation()
    assert original is not None
    workspace.set_threshold(1)
    refit(workspace)
    assert workspace.evaluation() == original
    proposals = workspace.require_proposals()
    assert proposals.abstained
