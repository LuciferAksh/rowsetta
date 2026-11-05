import argparse
import json
from statistics import median
from time import perf_counter
from urllib.request import OpenerDirector, ProxyHandler, Request, build_opener

import pandas as pd
from bench_smoke import SEED, penguins_split
from pydantic import BaseModel, ConfigDict

MODEL = "qwen3.6:35b-a3b"
LLM_EVAL_ROWS = 200
REQUEST_TIMEOUT_SECONDS = 600


class Message(BaseModel):
    """The non-streaming assistant content returned by Ollama."""

    content: str


class ChatResponse(BaseModel):
    """Require completion rather than timing a partial generation."""

    message: Message
    done: bool


class Label(BaseModel):
    """Accept one class, with no commentary or extra fields."""

    model_config = ConfigDict(extra="forbid")
    label: str


class ModelTag(BaseModel):
    """Identify the local model artifact independently of its mutable tag."""

    name: str
    digest: str


class TagsResponse(BaseModel):
    """Validate the local model inventory before running the smoke."""

    models: list[ModelTag]


def row_text(row: pd.Series, columns: list[str]) -> str:
    """Preserve CSV column order in the shared prompt prefix."""
    return "; ".join(f"{column}={row[column]}" for column in columns)


def predict_label(opener: OpenerDirector, prompt: str, classes: list[str]) -> str:
    """Constrain a local chat response to the known class names."""
    body = {
        "model": MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
        "think": False,
        "options": {"temperature": 0, "seed": SEED},
        "format": {
            "type": "object",
            "properties": {"label": {"type": "string", "enum": classes}},
            "required": ["label"],
            "additionalProperties": False,
        },
    }
    request = Request(
        "http://127.0.0.1:11434/api/chat",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with opener.open(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        result = ChatResponse.model_validate_json(response.read())
    if not result.done:
        message = "Ollama returned an incomplete generation."
        raise ValueError(message)
    label = Label.model_validate_json(result.message.content).label
    if label not in classes:
        message = f"Ollama returned an unknown class: {label}"
        raise ValueError(message)
    return label


def main() -> None:
    """Measure ten uncached, sequential penguins labels on local Ollama."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--smoke", action="store_true", required=True)
    parser.parse_args()
    opener = build_opener(ProxyHandler({}))
    with opener.open(
        "http://127.0.0.1:11434/api/tags", timeout=REQUEST_TIMEOUT_SECONDS
    ) as response:
        tags = TagsResponse.model_validate_json(response.read())
    matches = [model for model in tags.models if model.name == MODEL]
    if len(matches) != 1:
        message = f"Model missing; run: ollama pull {MODEL}"
        raise SystemExit(message)
    print(f"model={MODEL} digest={matches[0].digest}", flush=True)
    train, test = penguins_split()
    columns = [str(column) for column in train.columns if column != "species"]
    classes = sorted(str(label) for label in train["species"].unique())
    prefix = (
        "Label the row using the labelled examples. Return JSON with one label.\n"
        f"Columns: {', '.join(columns)}\n"
        + "\n".join(
            f"{row_text(row, columns)}; label={row['species']}" for _, row in train.iterrows()
        )
        + "\nRow to label:\n"
    )
    timings: list[float] = []
    correct = 0
    for number, (_, row) in enumerate(test.iterrows(), start=1):
        start = perf_counter()
        label = predict_label(opener, prefix + row_text(row, columns), classes)
        elapsed = perf_counter() - start
        timings.append(elapsed)
        correct += int(label == row["species"])
        print(f"row={number} label={label} seconds={elapsed:.6f}", flush=True)
    print(
        f"rows={len(timings)} accuracy={correct / len(timings):.6f} "
        f"seconds_per_row={sum(timings) / len(timings):.6f} "
        f"median_seconds_per_row={median(timings):.6f} total_seconds={sum(timings):.6f} "
        f"LLM_EVAL_ROWS={LLM_EVAL_ROWS}"
    )


if __name__ == "__main__":
    main()
