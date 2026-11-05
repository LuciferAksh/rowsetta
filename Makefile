.PHONY: setup dev check test build bench bench-full golden demo-gif browser

setup:
	uv sync --locked
	pnpm --dir frontend install --frozen-lockfile
	uv run --locked pre-commit install

dev:
	pnpm --dir frontend dev

check:
	uv run --locked ruff format --check .
	uv run --locked ruff check .
	uv run --locked pyright
	uv run --locked pytest -m "not model and not pg"
	pnpm --dir frontend format:check
	pnpm --dir frontend lint
	pnpm --dir frontend check
	pnpm --dir frontend test

test:
	uv run --locked pytest -m "not model and not pg"
	pnpm --dir frontend test

build:
	pnpm --dir frontend build
	uv build

golden:
	TABSTUDIO_UPDATE_SQL_GOLDENS=1 uv run --locked pytest tests/golden/test_sql.py

bench bench-full:
	uv run --locked --group bench python -m scripts.bench_full $(BENCH_ARGS)

demo-gif browser:
	@printf '%s\n' 'TODO: $@ is not implemented; see docs/development.md.'
	@exit 2
