import { describe, expect, it } from 'vitest';
import { BackendError, createBackend, type Fetch } from '../src/backend/http';
import type { TablePage, WorkspaceState } from '../src/backend/types';

const STATE: WorkspaceState = {
  loaded: true,
  notice: null,
  target: 'species',
  classes: ['Adelie', 'Chinstrap', 'Gentoo'],
  human: { '0': 'Adelie', '152': 'Chinstrap' },
  eval_count: 20,
  threshold: 0.6,
  excluded_columns: ['island'],
  generation: 4,
  refit_generation: 3,
  proposals: { '1': 'Adelie' },
  confidence: { '1': 0.93 },
  abstained: [7, 9],
  missing: { Gentoo: 2 },
  next_row: 11,
  evaluation: {
    n: 20,
    accuracy: { kind: 'measured', value: 0.9, lo: 0.7, hi: 0.97 },
    balanced_accuracy: { kind: 'needs_rows', counts: { Adelie: 9, Gentoo: 4 } },
    per_class_recall: { Adelie: 1, Chinstrap: null, Gentoo: 0.75 },
    majority_class: 'Adelie',
    majority_baseline: 0.45,
  },
  failure: null,
  dev_states: false,
};

const PAGE: TablePage = {
  rows: [
    { species: null, bill_length_mm: 39.1, island: 'Torgersen', ok: true },
  ],
  row_ids: [0],
  columns: [
    {
      name: 'bill_length_mm',
      kind: 'numeric',
      distinct_ratio: 0.48,
      missing_ratio: 0.01,
    },
  ],
  total: 344,
  source_rows: 344,
  page: 0,
  size: 1,
};

interface Sent {
  input: string;
  init: RequestInit;
}

function serving(response: () => Response): { fetch: Fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  return {
    sent,
    fetch: (input, init) => {
      sent.push({ input, init });
      return Promise.resolve(response());
    },
  };
}

async function failure(call: Promise<unknown>): Promise<BackendError> {
  const error: unknown = await call.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof BackendError)) {
    throw new Error(`expected a BackendError, got ${String(error)}`);
  }
  return error;
}

describe('successful responses', () => {
  it('returns the decoded workspace state', async () => {
    const { fetch, sent } = serving(() => Response.json(STATE));

    expect(await createBackend(fetch).state()).toEqual(STATE);
    expect(sent).toEqual([{ input: '/state', init: { method: 'GET' } }]);
  });

  it('accepts a state with no table loaded', async () => {
    const empty: WorkspaceState = {
      ...STATE,
      loaded: false,
      target: null,
      classes: [],
      human: {},
      eval_count: 0,
      threshold: 0,
      excluded_columns: [],
      generation: 0,
      refit_generation: null,
      proposals: {},
      confidence: {},
      abstained: [],
      missing: {},
      next_row: null,
      evaluation: null,
    };
    const { fetch } = serving(() => Response.json(empty));

    expect(await createBackend(fetch).state()).toEqual(empty);
  });

  it('carries a refit failure inside the state rather than rejecting', async () => {
    const failed = {
      ...STATE,
      failure: { error: 'Refit failed.', next_step: 'tabular-studio doctor' },
    };
    const { fetch } = serving(() => Response.json(failed));

    expect((await createBackend(fetch).state()).failure).toEqual(
      failed.failure,
    );
  });

  it('pages the table with explicit query parameters', async () => {
    const { fetch, sent } = serving(() => Response.json(PAGE));

    expect(
      await createBackend(fetch).tablePage({ page: 3, size: 100 }),
    ).toEqual(PAGE);
    expect(sent[0]?.input).toBe('/table?page=3&size=100');
  });

  it('sends a label as JSON to the row it names', async () => {
    const { fetch, sent } = serving(() => Response.json(STATE));

    await createBackend(fetch).setLabel(152, { label: null });

    expect(sent).toEqual([
      {
        input: '/labels/152',
        init: {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: '{"label":null}',
        },
      },
    ]);
  });

  it('escapes column names used as path segments', async () => {
    const { fetch, sent } = serving(() => Response.json(STATE));

    await createBackend(fetch).setExcluded('size/weight (g)', {
      excluded: true,
    });

    expect(sent[0]?.input).toBe('/columns/size%2Fweight%20(g)/excluded');
  });

  it('uploads one CSV file as multipart form data', async () => {
    const { fetch, sent } = serving(() => Response.json(STATE));
    const file = new File(['bill_length_mm\n39.1\n'], 'penguins.csv', {
      type: 'text/csv',
    });

    await createBackend(fetch).uploadCsv(file);

    const body = sent[0]?.init.body;
    expect(body).toBeInstanceOf(FormData);
    expect(body instanceof FormData ? [...body.values()] : []).toEqual([file]);
  });

  it('returns the next evaluation row, or null once none remain', async () => {
    const next = serving(() => Response.json({ row_id: 41 }));
    const done = serving(() => Response.json({ row_id: null }));

    expect(await createBackend(next.fetch).nextEvalRow()).toBe(41);
    expect(await createBackend(done.fetch).nextEvalRow()).toBeNull();
  });

  it('decodes distilled leaf lines and leak hints', async () => {
    const line = {
      line_no: 1,
      conditions: [['flipper_length_mm', '<=', '206.5']],
      label: 'Adelie',
      row_ids: [0, 1],
      agree: { k: 2, n: 2, coverage: { answered: 2, total: 2 } },
    };
    const leak = {
      column: 'id',
      kind: 'identifier',
      reason: 'Unique per row.',
      score: null,
    };
    const distilled = serving(() =>
      Response.json({ leaf_summary: [line], generation: 4 }),
    );
    const audited = serving(() => Response.json({ leaks: [leak] }));

    expect(
      await createBackend(distilled.fetch).distill({ max_depth: 2 }),
    ).toEqual({
      leaf_summary: [line],
      generation: 4,
    });
    expect(await createBackend(audited.fetch).audit()).toEqual([leak]);
  });

  it('returns SQL as text and a dbt project as files', async () => {
    const sql = serving(() => new Response('select 1;\n', { status: 200 }));
    const dbt = serving(() =>
      Response.json({ 'models/rule.sql': 'select 1;\n' }),
    );

    expect(
      await createBackend(sql.fetch).exportRule({
        format: 'sql',
        dialect: 'sqlite',
      }),
    ).toEqual({ format: 'sql', text: 'select 1;\n' });
    expect(sql.sent[0]?.input).toBe('/export?format=sql&dialect=sqlite');
    expect(
      await createBackend(dbt.fetch).exportRule({
        format: 'dbt',
        dialect: 'duckdb',
      }),
    ).toEqual({ format: 'dbt', files: { 'models/rule.sql': 'select 1;\n' } });
  });
});

describe('failures', () => {
  it('surfaces the backend error contract, including missing labels', async () => {
    const body = {
      error: 'Proposals start once every class has 2 labels.',
      next_step: 'tabular-studio demo; label 2 more rows of: Gentoo',
      missing: { Gentoo: 2 },
    };
    const { fetch } = serving(() => Response.json(body, { status: 409 }));

    const error = await failure(createBackend(fetch).undo());

    expect(error.kind).toBe('rejected');
    expect(error.status).toBe(409);
    expect(error.body).toEqual(body);
    expect(error.message).toBe(body.error);
  });

  it('reports an error response outside the contract as malformed', async () => {
    const { fetch } = serving(
      () => new Response('<html>Bad Gateway</html>', { status: 502 }),
    );

    const error = await failure(createBackend(fetch).state());

    expect(error.kind).toBe('malformed');
    expect(error.status).toBe(502);
    expect(error.body.next_step).not.toBe('');
  });

  it('names the offending field when a success response breaks the contract', async () => {
    const { fetch } = serving(() =>
      Response.json({ ...STATE, generation: '4' }),
    );

    const error = await failure(createBackend(fetch).state());

    expect(error.kind).toBe('malformed');
    expect(error.status).toBe(200);
    expect(error.body.error).toContain('state.generation');
  });

  it('rejects an evaluation with an unknown measurement kind', async () => {
    const evaluation = {
      ...STATE.evaluation,
      accuracy: { kind: 'guessed', value: 1 },
    };
    const { fetch } = serving(() => Response.json({ ...STATE, evaluation }));

    const error = await failure(createBackend(fetch).state());

    expect(error.body.error).toContain('state.evaluation.accuracy.kind');
  });

  it('reports a server that does not answer as unreachable', async () => {
    const cause = new TypeError('fetch failed');
    const backend = createBackend(() => Promise.reject(cause));

    const error = await failure(backend.state());

    expect(error.kind).toBe('unreachable');
    expect(error.status).toBeNull();
    expect(error.cause).toBe(cause);
  });
});
