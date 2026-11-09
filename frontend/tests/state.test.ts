import { describe, expect, it } from 'vitest';
import { BackendError, type Backend } from '../src/backend/http';
import type { ServerEvent, WorkspaceState } from '../src/backend/types';
import { Studio } from '../src/state.svelte';

const BASE: WorkspaceState = {
  loaded: true,
  notice: null,
  target: 'species',
  classes: ['Adelie', 'Chinstrap', 'Gentoo'],
  human: {},
  eval_count: 0,
  threshold: 0.6,
  excluded_columns: [],
  generation: 1,
  refit_generation: null,
  proposals: {},
  confidence: {},
  abstained: [],
  missing: {},
  next_row: 0,
  evaluation: null,
  failure: null,
  dev_states: false,
};

function at(
  generation: number,
  refit_generation: number | null = null,
): WorkspaceState {
  return { ...BASE, generation, refit_generation };
}

const REJECTED = new BackendError(
  'rejected',
  {
    error: 'Proposals start once every class has 2 labels.',
    next_step: 'label 2 more rows of: Gentoo',
    missing: { Gentoo: 2 },
  },
  409,
);

interface Pending<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function pending<T>(): Pending<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function unused(): never {
  throw new Error('not used by the workspace state');
}

// Serves `/state` from a queue and lets the test push server events.
function fakeBackend(states: (() => Promise<WorkspaceState>)[]) {
  let listener: ((event: ServerEvent) => void) | undefined;
  let stopped = false;
  const backend: Backend = {
    state: () => {
      const next = states.shift();
      if (next === undefined) throw new Error('unexpected /state request');
      return next();
    },
    loadDemo: unused,
    uploadCsv: unused,
    tablePage: unused,
    setTarget: unused,
    setLabel: unused,
    undo: unused,
    nextEvalRow: unused,
    setExcluded: unused,
    setThreshold: unused,
    distill: unused,
    audit: unused,
    exportRule: unused,
    health: unused,
    session: unused,
    events: (follow) => {
      listener = follow;
      return () => {
        stopped = true;
      };
    },
  };
  return {
    backend,
    send: (event: ServerEvent) => {
      if (listener === undefined) throw new Error('not following events');
      listener(event);
    },
    stopped: () => stopped,
    remaining: () => states.length,
  };
}

// Lets queued promise callbacks run.
function settled(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('following the server', () => {
  it('loads the state once the event stream connects', async () => {
    const server = fakeBackend([() => Promise.resolve(at(1))]);
    const studio = new Studio(server.backend);

    studio.start();
    expect(studio.connection).toBe('connecting');
    expect(studio.workspace).toBeNull();

    server.send({ kind: 'connected' });
    await settled();

    expect(studio.connection).toBe('live');
    expect(studio.workspace).toEqual(at(1));
  });

  it('stops following when the returned function is called', () => {
    const server = fakeBackend([]);
    const stop = new Studio(server.backend).start();

    stop();

    expect(server.stopped()).toBe(true);
  });

  it('shows refit progress, then refetches the state when the refit lands', async () => {
    const server = fakeBackend([
      () => Promise.resolve(at(2)),
      () => Promise.resolve(at(2, 2)),
    ]);
    const studio = new Studio(server.backend);
    studio.start();
    server.send({ kind: 'connected' });
    await settled();

    server.send({ kind: 'refit_started', generation: 2 });
    expect(studio.refit).toEqual({ done: 0, total: null });
    server.send({ kind: 'progress', done: 100, total: 338 });
    expect(studio.refit).toEqual({ done: 100, total: 338 });
    server.send({ kind: 'refit_done', generation: 2 });
    await settled();

    expect(studio.refit).toBeNull();
    expect(studio.workspace).toEqual(at(2, 2));
  });

  it('refetches the state after a failed refit so its failure shows', async () => {
    const failure = {
      error: 'The model file is missing or failed its checksum.',
      next_step: 'tabular-studio doctor --fix',
    };
    const server = fakeBackend([
      () => Promise.resolve(at(2)),
      () => Promise.resolve({ ...at(2), failure }),
    ]);
    const studio = new Studio(server.backend);
    studio.start();
    server.send({ kind: 'connected' });
    await settled();

    server.send({ kind: 'refit_started', generation: 2 });
    server.send({ kind: 'refit_failed', failure });
    await settled();

    expect(studio.refit).toBeNull();
    expect(studio.workspace?.failure).toEqual(failure);
  });

  it('marks a dropped stream and resynchronises with a restarted server', async () => {
    const server = fakeBackend([
      () => Promise.resolve(at(9, 9)),
      () => Promise.resolve(at(0)),
    ]);
    const studio = new Studio(server.backend);
    studio.start();
    server.send({ kind: 'connected' });
    await settled();

    server.send({ kind: 'disconnected', retryMs: 1000 });
    expect(studio.connection).toBe('reconnecting');
    server.send({ kind: 'connected' });
    await settled();

    expect(studio.connection).toBe('live');
    expect(studio.workspace).toEqual(at(0));
  });

  it('shows an event that broke the contract as the current problem', () => {
    const server = fakeBackend([]);
    const studio = new Studio(server.backend);
    studio.start();
    const failure = {
      error:
        'The local server sent an unexpected response (progress.done: expected an integer).',
      next_step: 'Reload this page; if it repeats, reinstall tabular-studio.',
    };

    server.send({ kind: 'malformed', failure });

    expect(studio.problem).toEqual(failure);
  });
});

describe('applying responses', () => {
  it('keeps a newer state when an older response arrives late', async () => {
    const studio = new Studio(fakeBackend([]).backend);
    const slow = pending<WorkspaceState>();
    const fast = pending<WorkspaceState>();

    const first = studio.apply(slow.promise);
    const second = studio.apply(fast.promise);
    fast.resolve(at(3));
    await second;
    slow.resolve(at(2));
    await first;

    expect(studio.workspace).toEqual(at(3));
  });

  it('takes a later refit of the same inputs', async () => {
    const studio = new Studio(fakeBackend([]).backend);

    await studio.apply(Promise.resolve(at(3, 2)));
    await studio.apply(Promise.resolve(at(3, 3)));
    await studio.apply(Promise.resolve(at(3)));

    expect(studio.workspace).toEqual(at(3, 3));
  });

  it('takes an equal state, which can differ in served evaluation rows', async () => {
    const studio = new Studio(fakeBackend([]).backend);
    const served = { ...at(3, 3), next_row: 41 };

    await studio.apply(Promise.resolve(at(3, 3)));
    await studio.apply(Promise.resolve(served));

    expect(studio.workspace).toEqual(served);
  });

  it('keeps the last state and shows the error contract when a request is refused', async () => {
    const studio = new Studio(fakeBackend([]).backend);
    await studio.apply(Promise.resolve(at(1)));

    await studio.apply(Promise.reject(REJECTED));

    expect(studio.workspace).toEqual(at(1));
    expect(studio.problem).toEqual(REJECTED.body);
  });

  it('clears the problem once a request succeeds', async () => {
    const studio = new Studio(fakeBackend([]).backend);
    await studio.apply(Promise.reject(REJECTED));

    await studio.apply(Promise.resolve(at(2)));

    expect(studio.problem).toBeNull();
  });

  it('lets a programming error propagate', async () => {
    const studio = new Studio(fakeBackend([]).backend);
    const bug = new TypeError('undefined is not a function');

    await expect(studio.apply(Promise.reject(bug))).rejects.toBe(bug);
    expect(studio.problem).toBeNull();
  });

  it('refreshes from /state on request', async () => {
    const server = fakeBackend([() => Promise.resolve(at(5))]);
    const studio = new Studio(server.backend);

    await studio.refresh();

    expect(studio.workspace).toEqual(at(5));
    expect(server.remaining()).toBe(0);
  });
});
