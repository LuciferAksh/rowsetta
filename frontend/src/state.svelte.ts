import { BackendError, type Backend } from './backend/http';
import type {
  ErrorBody,
  ServerEvent,
  TablePage,
  WorkspaceState,
} from './backend/types';
import {
  NO_PROPOSALS,
  PAGE_SIZE,
  isCurrent,
  nextProposals,
  type ShownProposals,
} from './labelling';

const PROPOSALS_UPDATED = 'Proposals updated';

export interface RefitProgress {
  done: number;
  /** `null` until the server reports how many rows the refit covers. */
  total: number | null;
}

export type Connection = 'connecting' | 'live' | 'reconnecting';

export interface Announcement {
  text: string;
}

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
  page = $state.raw<TablePage | null>(null);
  proposals = $state.raw<ShownProposals>(NO_PROPOSALS);
  /** For the polite live region; a new object each time, so a repeat is read again. */
  announcement = $state.raw<Announcement | null>(null);

  readonly #backend: Backend;
  #requestedPage = 0;

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
      if (current === null || !isOlder(next, current)) this.#show(next);
    });
  }

  refresh(): Promise<void> {
    return this.apply(this.#backend.state());
  }

  /** Set or, with `null`, clear a row's human label. */
  label(rowId: number, label: string | null): Promise<void> {
    return this.apply(this.#backend.setLabel(rowId, { label }));
  }

  undo(): Promise<void> {
    return this.apply(this.#backend.undo());
  }

  showPage(page: number): Promise<void> {
    this.#requestedPage = page;
    return this.#settle(
      this.#backend.tablePage({ page, size: PAGE_SIZE }),
      (next) => {
        if (next.page === this.#requestedPage) this.page = next;
      },
    );
  }

  #show(next: WorkspaceState): void {
    const previous = this.workspace;
    if (
      previous !== null &&
      isCurrent(next) &&
      next.refit_generation !== previous.refit_generation
    ) {
      this.announcement = { text: PROPOSALS_UPDATED };
    }
    this.proposals = nextProposals(this.proposals, next);
    this.workspace = next;
  }

  async #settle<T>(
    request: Promise<T>,
    take: (value: T) => void,
  ): Promise<void> {
    try {
      take(await request);
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
        void this.#settle(this.#backend.state(), (next) => {
          this.#show(next);
        });
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
