import { BackendError, type Backend } from './backend/http';
import type { ErrorBody, ServerEvent, WorkspaceState } from './backend/types';

export interface RefitProgress {
  done: number;
  /** `null` until the server reports how many rows the refit covers. */
  total: number | null;
}

export type Connection = 'connecting' | 'live' | 'reconnecting';

// Every edit raises `generation` and every published refit raises
// `refit_generation`, so a lower pair is a response a later one overtook.
function isOlder(next: WorkspaceState, current: WorkspaceState): boolean {
  if (next.generation !== current.generation) {
    return next.generation < current.generation;
  }
  return (next.refit_generation ?? -1) < (current.refit_generation ?? -1);
}

/** What the interface shows: the newest server state, refit progress and the last failure. */
export class Studio {
  workspace = $state.raw<WorkspaceState | null>(null);
  refit = $state.raw<RefitProgress | null>(null);
  /** The last refused request or broken response; cleared by the next success. */
  problem = $state.raw<ErrorBody | null>(null);
  connection = $state.raw<Connection>('connecting');

  readonly #backend: Backend;

  constructor(backend: Backend) {
    this.#backend = backend;
  }

  /** Follow server events, loading the state on each connection; returns a function that stops. */
  start(): () => void {
    return this.#backend.events((event) => {
      this.#receive(event);
    });
  }

  /** Show the state a request returns, unless a newer one has already arrived. */
  apply(request: Promise<WorkspaceState>): Promise<void> {
    return this.#settle(request, (next) => {
      const current = this.workspace;
      return current === null || !isOlder(next, current);
    });
  }

  refresh(): Promise<void> {
    return this.apply(this.#backend.state());
  }

  async #settle(
    request: Promise<WorkspaceState>,
    accept: (next: WorkspaceState) => boolean,
  ): Promise<void> {
    try {
      const next = await request;
      if (accept(next)) this.workspace = next;
      this.problem = null;
    } catch (error) {
      if (!(error instanceof BackendError)) throw error;
      this.problem = error.body;
    }
  }

  #receive(event: ServerEvent): void {
    switch (event.kind) {
      case 'connected':
        this.connection = 'live';
        // A restarted server counts generations from zero again, so the
        // state after a reconnection replaces whatever was shown.
        void this.#settle(this.#backend.state(), () => true);
        break;
      case 'disconnected':
        this.connection = 'reconnecting';
        break;
      case 'refit_started':
        this.refit = { done: 0, total: null };
        break;
      case 'progress':
        this.refit = { done: event.done, total: event.total };
        break;
      case 'refit_done':
      case 'refit_failed':
        this.refit = null;
        void this.refresh();
        break;
      case 'malformed':
        this.problem = event.failure;
        break;
    }
  }
}
