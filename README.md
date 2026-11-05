# Tabular Studio (working title)

Local tabular labelling and rule export.

This repository is at the scaffold stage. The product name is provisional.
Model acquisition, labelling, rule export and the application UI are not implemented yet.

## Develop

Use Python 3.13, uv 0.13.7, Node 26 and pnpm 12.16.1. Install gitleaks 8.30.1
for secret scanning. These commands do not require an account or model token.

```sh
make setup
make check
make dev
```

`make dev` serves the frontend skeleton at <http://127.0.0.1:5173>.
The API server is not implemented yet. `make build` builds the frontend and Python package
separately; frontend wheel integration remains pending.

```sh
uv run tabular-studio --help
gitleaks git --redact
```

See [development notes](docs/development.md),
[architecture](docs/architecture.md) and [contributing](CONTRIBUTING.md).

## Licence

Code is licensed under [Apache-2.0](LICENSE). Third-party licences and
attributions are retained in [NOTICE](NOTICE). No model weights or datasets
are bundled at this stage.
