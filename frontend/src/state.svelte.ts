import { BackendError, type Backend } from './backend/http';
import type {
  Distilled,
  ErrorBody,
  ExportArtifact,
  ExportQuery,
  LeakHint,
  ServerEvent,
  TablePage,
  TargetInput,
  WorkspaceState,
} from './backend/types';
import {
  NO_PROPOSALS,
  PAGE_SIZE,
  isCurrent,
  nextProposals,
  type ShownProposals,
} from './labelling';
import { fetchWholeTable, filteredPage, type WholeTable } from './rows';
import { certificateFigures } from './certificate';
import { DEFAULT_RULE_DEPTH, type RowFilter } from './rule';

const PROPOSALS_UPDATED = 'Proposals updated';
const NOTHING_TO_EVALUATE = 'Every row without a human label has been served.';
const NOTHING_SUGGESTED = 'No unlabelled row is left to suggest.';

export interface RefitProgress {
  done: number;
  /** `null` until the server reports how many rows the refit covers. */
  total: number | null;
}

export type Connection = 'connecting' | 'live' | 'reconnecting';

export interface Announcement {
  text: string;
}

/**
 * Labelling, or blind evaluation of the row the server served (`null` once
 * every eligible row has been served).
 */
export type Mode = { kind: 'label' } | { kind: 'evaluate'; row: number | null };

// An audit skips excluded columns, so a hint the user acted on is kept to show it struck.
function mergeLeaks(
  shown: readonly LeakHint[],
  fresh: readonly LeakHint[],
  excluded: readonly string[],
): readonly LeakHint[] {
  const kept = shown.filter(
    (hint) =>
      excluded.includes(hint.column) &&
      !fresh.some((other) => other.column === hint.column),
  );
  return [...kept, ...fresh];
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
  /** Rows in the working table, from the last unfiltered page. */
  rowCount = $state.raw<number | null>(null);
  proposals = $state.raw<ShownProposals>(NO_PROPOSALS);
  /** For the polite live region; a new object each time, so a repeat is read again. */
  announcement = $state.raw<Announcement | null>(null);
  mode = $state.raw<Mode>({ kind: 'label' });
  /** Narrows the table, such as to one rule line's rows; `null` shows every row. */
  filter = $state.raw<RowFilter | null>(null);
  /** A row the table moves focus to once its page is shown. */
  focusRow = $state.raw<number | null>(null);
  rule = $state.raw<Distilled | null>(null);
  /** The rule in the chosen format, as the server checked and sent it. */
  exported = $state.raw<ExportArtifact | null>(null);
  exportQuery = $state.raw<ExportQuery>({ format: 'sql', dialect: 'duckdb' });
  /** The certificate lines of the last export; the same for every format. */
  certificate = $state.raw<readonly string[]>([]);
  leaks = $state.raw<readonly LeakHint[]>([]);
  keySheetOpen = $state.raw(false);

  readonly #backend: Backend;
  #requestedPage = 0;
  #unfilteredPage = 0;
  #wholeTable: Promise<WholeTable> | null = null;

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

  /**
   * Set or, with `null`, clear a row's human label. During evaluation only the
   * served row takes a label, as an evaluation label, and the next row is served.
   */
  async label(rowId: number, label: string | null): Promise<void> {
    const mode = this.mode;
    if (mode.kind === 'label') {
      await this.apply(this.#backend.setLabel(rowId, { label }));
      return;
    }
    if (rowId !== mode.row || label === null) return;
    await this.apply(this.#backend.setLabel(rowId, { label, mode: 'eval' }));
    if (this.problem === null) await this.#serve();
  }

  undo(): Promise<void> {
    return this.apply(this.#backend.undo());
  }

  /** Replace the table; the server keeps a saved session for these exact bytes. */
  async upload(file: File): Promise<void> {
    this.#forgetTable();
    await this.apply(this.#backend.uploadCsv(file));
    if (this.problem === null) await this.showPage(0);
  }

  async chooseTarget(input: TargetInput): Promise<void> {
    this.#forgetLabels();
    await this.apply(this.#backend.setTarget(input));
  }

  setThreshold(threshold: number): Promise<void> {
    return this.apply(this.#backend.setThreshold({ threshold }));
  }

  exclude(column: string, excluded: boolean): Promise<void> {
    return this.apply(this.#backend.setExcluded(column, { excluded }));
  }

  showRule(maxDepth: number = DEFAULT_RULE_DEPTH): Promise<void> {
    return this.#settle(
      this.#backend.distill({ max_depth: maxDepth }),
      (rule) => {
        this.rule = rule;
      },
    );
  }

  /** Fit the rule at a depth, then export it in the chosen format with its certificate. */
  async exportRule(maxDepth: number): Promise<void> {
    this.exported = null;
    this.certificate = [];
    await this.showRule(maxDepth);
    if (this.problem === null) await this.showExport(this.exportQuery);
  }

  /** Show the fitted rule in another format or dialect. */
  showExport(query: ExportQuery): Promise<void> {
    this.exportQuery = query;
    return this.#settle(this.#backend.exportRule(query), async (artifact) => {
      // A slower answer for a format the user has already left is dropped.
      if (this.exportQuery !== query) return;
      this.exported = artifact;
      const figures = certificateFigures(artifact);
      if (figures.length > 0) this.certificate = figures;
      if (this.certificate.length > 0) return;
      // JSON carries the certificate as data; the SQL export states it as lines.
      await this.#settle(
        this.#backend.exportRule({ format: 'sql', dialect: 'duckdb' }),
        (sql) => {
          this.certificate = certificateFigures(sql);
        },
      );
    });
  }

  checkLeaks(): Promise<void> {
    return this.#settle(this.#backend.audit(), (fresh) => {
      this.leaks = mergeLeaks(
        this.leaks,
        fresh,
        this.workspace?.excluded_columns ?? [],
      );
    });
  }

  /** Enter evaluation on the next served row, or leave it. */
  async toggleEvaluation(): Promise<void> {
    if (this.mode.kind === 'evaluate') {
      this.mode = { kind: 'label' };
      return;
    }
    await this.#serve();
  }

  async nextSuggested(): Promise<void> {
    const next = this.workspace?.next_row ?? null;
    if (next === null) {
      this.announcement = { text: NOTHING_SUGGESTED };
      return;
    }
    await this.goToRow(next);
  }

  /** Show every row again on the page that row is on, and focus it there. */
  async goToRow(rowId: number): Promise<void> {
    if (this.filter === null && this.page?.row_ids.includes(rowId) === true) {
      this.focusRow = rowId;
      return;
    }
    await this.#settle(this.#table(), async (table) => {
      const position = table.rowIds.indexOf(rowId);
      if (position === -1) return;
      this.filter = null;
      this.focusRow = rowId;
      await this.showPage(Math.floor(position / PAGE_SIZE));
    });
  }

  /** Narrow the table to some rows, or with `null` return to the page shown before. */
  filterRows(filter: RowFilter | null): Promise<void> {
    // Focus and click both arrive for one click on a rule line.
    if (filter !== null && filter.rowIds === this.filter?.rowIds) {
      return Promise.resolve();
    }
    if (this.filter === null) this.#unfilteredPage = this.page?.page ?? 0;
    this.filter = filter;
    if (filter !== null) this.announcement = { text: filter.description };
    return this.showPage(filter === null ? this.#unfilteredPage : 0);
  }

  showPage(page: number): Promise<void> {
    this.#requestedPage = page;
    const filter = this.filter;
    const request =
      filter === null
        ? this.#backend.tablePage({ page, size: PAGE_SIZE })
        : this.#filteredPage(filter, page);
    return this.#settle(request, (next) => {
      if (filter === null) this.rowCount = next.total;
      if (next.page === this.#requestedPage && this.filter === filter) {
        this.page = next;
      }
    });
  }

  async #serve(): Promise<void> {
    await this.#settle(this.#backend.nextEvalRow(), async (row) => {
      this.mode = { kind: 'evaluate', row };
      if (row === null) {
        this.announcement = { text: NOTHING_TO_EVALUATE };
        return;
      }
      this.announcement = { text: `Evaluation row ${String(row)}` };
      await this.goToRow(row);
    });
  }

  async #filteredPage(filter: RowFilter, page: number): Promise<TablePage> {
    return filteredPage(await this.#table(), filter, page);
  }

  #table(): Promise<WholeTable> {
    this.#wholeTable ??= fetchWholeTable(this.#backend).catch(
      (error: unknown) => {
        this.#wholeTable = null;
        throw error;
      },
    );
    return this.#wholeTable;
  }

  #forgetLabels(): void {
    this.mode = { kind: 'label' };
    this.rule = null;
    this.exported = null;
    this.certificate = [];
    this.leaks = [];
    if (this.filter !== null) void this.filterRows(null);
  }

  #forgetTable(): void {
    this.#forgetLabels();
    this.#wholeTable = null;
    this.rowCount = null;
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
    take: (value: T) => void | Promise<void>,
  ): Promise<void> {
    try {
      const value = await request;
      this.problem = null;
      await take(value);
    } catch (error) {
      if (!(error instanceof BackendError)) throw error;
      this.problem = error.body;
    }
  }

  #receive(event: ServerEvent): void {
    switch (event.kind) {
      case 'connected':
        this.connection = 'live';
        this.#wholeTable = null;
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
