from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from tabular_studio.core.session import MAX_CLASSES, MIN_CLASSES


class InputModel(BaseModel):
    """Reject unknown fields at the HTTP boundary."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class DemoInput(InputModel):
    """Select the bundled offline demo."""

    demo: Literal["penguins"]


class TargetInput(InputModel):
    """Declare a target and its class vocabulary without importing source answers."""

    target: str = Field(min_length=1)
    classes: tuple[str, ...] = Field(min_length=MIN_CLASSES, max_length=MAX_CLASSES)

    @model_validator(mode="after")
    def distinct_classes(self) -> Self:
        """Reject ambiguous or empty class names before replacing the session."""
        if len(set(self.classes)) != len(self.classes) or any(not name for name in self.classes):
            message = "Classes must be distinct, nonempty names."
            raise ValueError(message)
        return self


class LabelInput(InputModel):
    """Set or clear one answer in the selected labelling mode."""

    label: str | None
    mode: Literal["human", "eval"] = "human"


class ExclusionInput(InputModel):
    """Whether a source feature is omitted from teacher and rule fitting."""

    excluded: bool


class ThresholdInput(InputModel):
    """Minimum probability or leaf purity required for an answer."""

    threshold: float = Field(ge=0, le=1, allow_inf_nan=False)


class DistillInput(InputModel):
    """Select the maximum depth for the distilled rule."""

    max_depth: int = Field(default=4, ge=1)
