# Tabular Studio (working title)

Local tabular labelling and rule export.

Label a few rows of a CSV, let a local model propose the rest, check it on
random rows and export the result as a decision tree in SQL, dbt, Python or
JSON. The product name is provisional.

## Develop

Use Python 3.13, uv 0.13.7, Node 26 and pnpm 12.16.1. Install gitleaks 8.30.1
for secret scanning. These commands do not require an account or model token.

```sh
make setup
make check
make dev
```

`make dev` serves the frontend at <http://127.0.0.1:5173> and forwards API
requests to a local server on port 8787, which `uv run tabular-studio demo
--no-browser --port 8787` starts. `make build` builds a wheel with the web page
inside it.

```sh
uv run tabular-studio --help
gitleaks git --redact
```

See [development notes](docs/development.md),
[architecture](docs/architecture.md) and [contributing](CONTRIBUTING.md).

## Licence

Code is licensed under [Apache-2.0](LICENSE). Third-party licences and
attributions are retained in [NOTICE](NOTICE). The bundled datasets and their
licences are listed in [datasets/CARDS.md](datasets/CARDS.md). Model weights are
not bundled; the first run of `demo` or `open` downloads them.
