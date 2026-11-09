import * as decode from './decode';
import type {
  DemoInput,
  Distilled,
  DistillInput,
  ErrorBody,
  ExclusionInput,
  ExportArtifact,
  ExportQuery,
  LabelInput,
  LeakHint,
  TablePage,
  TableQuery,
  TargetInput,
  ThresholdInput,
  WorkspaceState,
} from './types';

export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Why a request failed: the server refused it with its error contract, no server
 * answered, or the answer did not have the shape these types declare.
 */
export type FailureKind = 'rejected' | 'unreachable' | 'malformed';

/** Every failure carries an `ErrorBody`, so the interface renders all three the same way. */
export class BackendError extends Error {
  constructor(
    readonly kind: FailureKind,
    readonly body: ErrorBody,
    /** `null` when no response arrived. */
    readonly status: number | null,
    options?: ErrorOptions,
  ) {
    super(body.error, options);
    this.name = 'BackendError';
  }
}

const UNREACHABLE: ErrorBody = {
  error: 'The local server did not respond.',
  next_step:
    'Check that tabular-studio is still running in your terminal, then reload this page.',
};

// The likeliest cause is a page left open across an upgrade, served by a newer server.
const MALFORMED_NEXT_STEP =
  'Reload this page; if it repeats, reinstall tabular-studio.';

export interface Backend {
  state(): Promise<WorkspaceState>;
  loadDemo(): Promise<WorkspaceState>;
  uploadCsv(file: File): Promise<WorkspaceState>;
  tablePage(query: TableQuery): Promise<TablePage>;
  setTarget(input: TargetInput): Promise<WorkspaceState>;
  setLabel(rowId: number, input: LabelInput): Promise<WorkspaceState>;
  undo(): Promise<WorkspaceState>;
  /** The next blind evaluation row, or `null` when every row has been served. */
  nextEvalRow(): Promise<number | null>;
  setExcluded(column: string, input: ExclusionInput): Promise<WorkspaceState>;
  setThreshold(input: ThresholdInput): Promise<WorkspaceState>;
  distill(input: DistillInput): Promise<Distilled>;
  /** Columns that may leak the answer; empty until enough human labels exist. */
  audit(): Promise<LeakHint[]>;
  /** The current rule, after the server has checked its SQL against every source row. */
  exportRule(query: ExportQuery): Promise<ExportArtifact>;
}

function malformed(status: number, cause: Error): BackendError {
  return new BackendError(
    'malformed',
    {
      error: `The local server sent an unexpected response (${cause.message}).`,
      next_step: MALFORMED_NEXT_STEP,
    },
    status,
    { cause },
  );
}

function isDecodingFailure(
  error: unknown,
): error is decode.DecodeError | SyntaxError {
  return error instanceof decode.DecodeError || error instanceof SyntaxError;
}

async function rejection(response: Response): Promise<BackendError> {
  try {
    const body = decode.errorBody(await response.json(), 'error');
    return new BackendError('rejected', body, response.status);
  } catch (error) {
    if (!isDecodingFailure(error)) throw error;
    return malformed(response.status, error);
  }
}

async function decoded<T>(
  response: Response,
  decodeBody: (value: unknown, path: string) => T,
  path: string,
): Promise<T> {
  try {
    return decodeBody(await response.json(), path);
  } catch (error) {
    if (!isDecodingFailure(error)) throw error;
    throw malformed(response.status, error);
  }
}

function json(method: 'POST' | 'PUT', body: object): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/** Same-origin client; the launch cookie authenticates each request. */
export function createBackend(
  fetchResource: Fetch = (input, init) => fetch(input, init),
): Backend {
  async function send(input: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await fetchResource(input, init);
    } catch (cause) {
      throw new BackendError('unreachable', UNREACHABLE, null, { cause });
    }
    if (!response.ok) throw await rejection(response);
    return response;
  }

  async function workspace(
    input: string,
    init: RequestInit,
  ): Promise<WorkspaceState> {
    return decoded(await send(input, init), decode.workspaceState, 'state');
  }

  const get: RequestInit = { method: 'GET' };
  const demo: DemoInput = { demo: 'penguins' };

  return {
    state: () => workspace('/state', get),
    loadDemo: () => workspace('/table', json('POST', demo)),
    uploadCsv: (file) => {
      const form = new FormData();
      form.append('file', file, file.name);
      return workspace('/table', { method: 'POST', body: form });
    },
    tablePage: async ({ page, size }) => {
      const query = new URLSearchParams({
        page: String(page),
        size: String(size),
      });
      return decoded(
        await send(`/table?${query.toString()}`, get),
        decode.tablePage,
        'table',
      );
    },
    setTarget: (input) => workspace('/target', json('POST', input)),
    setLabel: (rowId, input) =>
      workspace(`/labels/${String(rowId)}`, json('PUT', input)),
    undo: () => workspace('/undo', { method: 'POST' }),
    nextEvalRow: async () =>
      decoded(await send('/eval/next', get), decode.nextEvalRow, 'eval'),
    setExcluded: (column, input) =>
      workspace(
        `/columns/${encodeURIComponent(column)}/excluded`,
        json('PUT', input),
      ),
    setThreshold: (input) => workspace('/threshold', json('PUT', input)),
    distill: async (input) =>
      decoded(
        await send('/distill', json('POST', input)),
        decode.distilled,
        'distill',
      ),
    audit: async () =>
      decoded(await send('/audit', get), decode.leaks, 'audit'),
    exportRule: async ({ format, dialect }) => {
      const query = new URLSearchParams({ format, dialect });
      const response = await send(`/export?${query.toString()}`, get);
      if (format === 'dbt') {
        return {
          format,
          files: await decoded(response, decode.dbtFiles, 'export'),
        };
      }
      return { format, text: await response.text() };
    },
  };
}
