# 0009: Third-party browser pieces

Status: source review complete; browser integration and weight mirror pending.

Verified on 2026-11-05 against the npm tarball, not a repository checkout.

## Artifact and attribution

`npm pack forecast-web@1.0.0 --ignore-scripts` downloaded the published artifact.
Both the registry metadata at
<https://registry.npmjs.org/forecast-web/1.0.0> and the downloaded bytes match the
integrity required by the browser dependency review:

```text
sha512-gq0XEdKIEtiBDF902lR1br3bMif0pE9q3NctjTwDqFFEsVd+PHGfzRXymiPtF1Yz0puxuvDWgD87hthgaA5uHg==
SHA-256 e4babb0cb179238a3110e32eec377df6d0032deb16f1441b79c5c3477bc8b499
```

`package.json` declares Apache-2.0 and the archive includes its full LICENSE.
NOTICE credits Vatsal Bakshi (2026), Google Research TimesFM (Apache-2.0),
Amazon Chronos (Apache-2.0), and the Soda team at Inria's TabICL, with the complete
BSD-3-Clause terms. Preserve LICENSE and NOTICE in the vendored archive and
distributions. The archive's ONNX Runtime dependency is `^1.30.0`; the application
lockfile must make that resolution reproducible.

## Network and data review

Read all of `dist/tabular.js`, its imported shared chunks, the session adapter
and the worker entry. This is a static review; no browser network trace was run.

- `tabular.js` preprocesses table rows locally. It passes typed tensors to
  `graph.run`, either in the same context or by `Worker.postMessage` to the
  package's local worker. Neither path sends table contents over HTTP.
- `chunk-SPUU25AM.js` resolves the configured weights base and GETs `config.json`,
  the ONNX graph and, for fp16, its external weights. Its only explicit `fetch`
  call is `fetch(url, { signal })`, with no request body. The default source is
  the pinned Hugging Face repository. Redirect destinations need a browser trace
  during browser integration before finalizing CSP.
- There are requests beyond weight downloads: `chunk-YLEDJ6OR.js` sets
  `ort.env.wasm.wasmPaths` to
  `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ort.env.versions.web}/dist/`
  unless overridden. ONNX Runtime can load runtime assets there. Bundled worker
  and dynamic module imports also load application assets. Thus the answer to
  "only weight-download requests?" is no.
- No analytics, `XMLHttpRequest`, `WebSocket` or `sendBeacon` call was found in
  the package's shipped JavaScript. ONNX Runtime itself was not audited here;
  the browser integration and network assertions remain required.
- `https://forecast-web.invalid/sha256/...` is a Cache Storage key, never passed
  to `fetch` on this code path.

## Integrity limitations for browser integration

`resolvePin` in `chunk-A6PUF3V3.js` drops embedded file hashes when `weights`
points at a different repository. Mirror loads then obtain hashes from
`config.json`. A mirror must preserve those file entries and use an immutable
revision. `config.json` itself is not checked against an embedded digest.

Fresh graph/weight downloads are SHA-256 checked when hash metadata exists and
Web Crypto is available. Existing Cache Storage hits return before `verify`,
and `verify` returns without checking when `crypto.subtle` is unavailable.
Consequently the package alone does not satisfy the planned verification of
cached weights on read. Browser integration and network checks must account for that requirement before
claiming it. No adapter or core code was changed during this verification job.

## Fit and predict limits

`dist/tabular.js:542` exports:

```javascript
Object.freeze({ maxRows: 5000, maxFeatures: 100, maxCells: 20000 });
```

`validate` rejects a fit if any of those caps is exceeded, using the original
input width before constant-column filtering. Test rows have no fixed row cap;
`validateTest` checks their width, and prediction chunks them internally.
The planned browser check is therefore inclusive at 1,250 x 16 and rejects
1,251 x 16. Classification supports at most 10 classes in the reviewed model
metadata. These are library limits, not measured latency or memory guarantees.

## Benchmark source verification

The first download measured these SHA-256 values. They are pinned in
`scripts/fetch_bench_datasets.py`; subsequent reads verify cached bytes too.
Archives are benchmark-only, outside the distributed dataset package.

| Dataset | Archive bytes | SHA-256 |
| --- | --- | --- |
| Dry Bean | 4738776 | `0a64eff5be87f48c3dbbfc0a12a56c5d5b5167ef8e61cd45d69b3e7c7130c06f` |
| Mushroom | 141318 | `face32f32647e0d939f6233f36dd30dd5d619ae9f3f9b8e10bea4ac7e1f60b1a` |
| Car Evaluation | 6342 | `1559d51dcf327f4f8c71b711ceed7fd95a382fc8d8e1998667f4f23b82860403` |

Each UCI page explicitly states CC BY 4.0, checked on 2026-11-05:
[Dry Bean](https://archive.ics.uci.edu/dataset/602/dry+bean+dataset),
[Mushroom](https://archive.ics.uci.edu/dataset/73/mushroom),
[Car Evaluation](https://archive.ics.uci.edu/dataset/19/car+evaluation).
No source was dropped for its licence.

The fetcher stores the source ZIPs under
`~/.cache/tabular-studio/bench/`, or beneath `XDG_CACHE_HOME` when set. It checks
before writing or consuming a cache entry. Both normal mode and `--verify`
download missing archives and verify all three. A mismatch exits nonzero and
leaves the existing file available for inspection and explicit removal.

## Verification commands

```sh
uv run python scripts/fetch_bench_datasets.py --verify
uv run pytest tests/unit/test_cards.py
```

The archive command exited 0 with:

```text
dry_bean: 0a64eff5be87f48c3dbbfc0a12a56c5d5b5167ef8e61cd45d69b3e7c7130c06f (4738776 bytes)
mushroom: face32f32647e0d939f6233f36dd30dd5d619ae9f3f9b8e10bea4ac7e1f60b1a (141318 bytes)
car: 1559d51dcf327f4f8c71b711ceed7fd95a382fc8d8e1998667f4f23b82860403 (6342 bytes)
Verified 3 benchmark archives in /private/tmp/tabular-t03-cache/tabular-studio/bench
```

Sandbox execution used `UV_CACHE_DIR=/private/tmp/tabular-t03-uv` and
`XDG_CACHE_HOME=/private/tmp/tabular-t03-cache` to avoid writes outside the job's
writable roots. These change cache locations, not the probes or data.
