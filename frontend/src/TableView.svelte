<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
  import { tick, untrack } from 'svelte';
  import type { Cell } from './backend/types';
  import { shownSuspects } from './audit';
  import LabelMenu from './LabelMenu.svelte';
  import {
    missingText,
    rowLabel,
    rowLabelText,
    tableCommand,
  } from './labelling';
  import { columnDecimals, disagreementLines } from './rule';
  import type { Studio } from './state.svelte';

  let { studio }: { studio: Studio } = $props();

  const workspace = $derived(studio.workspace);
  const page = $derived(studio.page);
  const loaded = $derived(workspace?.loaded ?? false);
  const target = $derived(workspace?.target ?? null);
  const classes = $derived(workspace?.classes ?? []);
  const human = $derived(workspace?.human ?? {});
  const missing = $derived(missingText(workspace?.missing ?? {}));
  const columns = $derived(
    page?.columns.filter((column) => column.name !== target) ?? [],
  );
  const mode = $derived(studio.mode);
  const ruleLines = $derived(disagreementLines(studio.rule));
  const suspects = $derived(shownSuspects(studio.suspects, human, studio.kept));
  const decimals = $derived(columnDecimals(page?.rows ?? []));

  // Roving focus: only the active row's label cell is in the tab order.
  let active = $state(0);
  let menuRow = $state<number | null>(null);
  const cells: (HTMLButtonElement | null)[] = [];

  // The marker pass: a finished audit tours its worst rows in rank order, one
  // stroke after another. Any input interrupts it, and the rest are marked at once.
  const TOUR_ROWS = 6;
  const SCROLL_MS = 420;
  const STROKE_MS = 520;
  const INTERRUPTS = ['wheel', 'keydown', 'pointerdown'] as const;
  let pass: AbortController | null = null;

  function wait(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }

  async function runPass(): Promise<void> {
    pass?.abort();
    const control = new AbortController();
    const interrupted = () => control.signal.aborted;
    pass = control;
    const ranked = [...suspects.values()]
      .filter((item) => item.state === 'open')
      .sort((a, b) => a.rank - b.rank);
    const everyRow = new SvelteSet(ranked.map((item) => item.suspect.row_id));
    if (ranked.length === 0) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      studio.marked = everyRow;
      return;
    }
    const stop = (): void => {
      control.abort();
    };
    for (const type of INTERRUPTS) {
      addEventListener(type, stop, { once: true, passive: true });
    }
    document.addEventListener('visibilitychange', stop, { once: true });
    let done = new SvelteSet<number>();
    studio.marked = done;
    const onPage = ranked.filter((item) =>
      page?.row_ids.includes(item.suspect.row_id),
    );
    if (onPage.length === 0 && studio.filter === null) {
      const [first] = ranked;
      if (first) await studio.goToRow(first.suspect.row_id);
    }
    for (const { suspect } of onPage.slice(0, TOUR_ROWS)) {
      if (control.signal.aborted) break;
      const row = document.getElementById(`row-${String(suspect.row_id)}`);
      if (!row) continue;
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      await wait(SCROLL_MS, control.signal);
      if (interrupted()) break;
      done = new SvelteSet(done).add(suspect.row_id);
      studio.marked = done;
      await wait(STROKE_MS, control.signal);
    }
    for (const type of INTERRUPTS) removeEventListener(type, stop);
    document.removeEventListener('visibilitychange', stop);
    // A newer pass or a reset owns `marked` now; do not overwrite it.
    if (pass === control) studio.marked = everyRow;
  }

  $effect(() => {
    // Only a new audit result starts a pass, never a relabelled row.
    if (studio.suspects === null) {
      pass?.abort();
      pass = null;
      return;
    }
    untrack(() => {
      void runPass();
    });
  });

  function chipText(state: ReturnType<typeof rowLabel>): {
    lead: string;
    word: string;
    tail: string;
  } {
    const stale =
      state.kind === 'human' || state.kind === 'unlabelled'
        ? false
        : state.stale;
    const tail = stale ? ', updating' : '';
    switch (state.kind) {
      case 'human':
        return { lead: 'Labelled ', word: state.label, tail };
      case 'proposed':
        return { lead: 'Proposed ', word: state.label, tail };
      case 'unsure':
        return { lead: '', word: 'Unsure', tail };
      case 'unlabelled':
        return { lead: 'Unlabelled', word: '', tail };
    }
  }

  /** One fixed precision per column, so decimals line up down the page. */
  function show(value: Cell | undefined, column: string): string {
    const places = decimals.get(column);
    return typeof value === 'number' && places !== undefined
      ? value.toFixed(places)
      : display(value);
  }

  function pick(rowId: number): void {
    studio.selectedRow = rowId;
    document
      .getElementById(`slip-${String(rowId)}`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  $effect(() => {
    // Only a newly loaded table resets the page; filters choose their own.
    if (loaded) void untrack(() => studio.showPage(0));
  });

  $effect(() => {
    const index = page?.row_ids.indexOf(studio.focusRow ?? -1) ?? -1;
    if (index === -1) return;
    studio.focusRow = null;
    // The new page's cells are bound after this effect runs.
    void tick().then(() => {
      focusRow(index);
    });
  });

  // Evaluation takes a label for the served row only; the others stay inert.
  function inert(rowId: number): boolean {
    return mode.kind === 'evaluate' && rowId !== mode.row;
  }

  function display(value: Cell | undefined): string {
    return value === null || value === undefined ? '' : String(value);
  }

  function showPage(index: number): void {
    active = 0;
    menuRow = null;
    void studio.showPage(index);
  }

  function focusRow(index: number): void {
    const cell = cells[index];
    if (!cell) return;
    active = index;
    cell.focus();
  }

  function onCellKey(event: KeyboardEvent, index: number, rowId: number): void {
    const command = tableCommand(event);
    if (command === null) return;
    event.preventDefault();
    switch (command.kind) {
      case 'move':
        focusRow(index + command.by);
        break;
      case 'label': {
        const label = classes[command.classIndex];
        if (label !== undefined) void studio.label(rowId, label);
        break;
      }
      case 'undo':
        void studio.undo();
        break;
      case 'next':
        void studio.nextSuggested();
        break;
      case 'evaluate':
        void studio.toggleEvaluation();
        break;
      case 'keys':
        studio.keySheetOpen = true;
        break;
    }
  }

  function closeMenu(index: number, label?: string | null): void {
    const rowId = menuRow;
    menuRow = null;
    if (rowId !== null && label !== undefined) void studio.label(rowId, label);
    focusRow(index);
  }
</script>

<section class="sheet" aria-labelledby="table-heading">
  <h2 id="table-heading" class="visually-hidden">Rows</h2>
  {#if target === null}
    <p class="note-line">Choose a target column to start labelling.</p>
  {:else if missing !== ''}
    <p class="note-line">{missing}</p>
  {/if}
  {#if studio.refit !== null}
    <p class="refit">
      Updating proposals{#if studio.refit.total !== null}, {studio.refit.done}
        of {studio.refit.total} rows{/if}
    </p>
    {#if studio.refit.total === null}
      <progress aria-label="Updating proposals"></progress>
    {:else}
      <progress
        aria-label="Updating proposals"
        max={studio.refit.total}
        value={studio.refit.done}
      ></progress>
    {/if}
  {/if}
  {#if studio.filter !== null}
    <p class="filter-bar">
      <span>{studio.filter.description}.</span>
      <button
        type="button"
        class="button"
        onclick={() => {
          void studio.filterRows(null);
        }}
      >
        Show all rows
      </button>
    </p>
  {/if}
  {#if page !== null}
    {@const first = page.page * page.size}
    <!-- A scrollable region must take focus, or a keyboard cannot reach cells past its edge. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="scroll" role="region" aria-label="Table rows" tabindex="0">
      <table aria-rowcount={page.total + 1}>
        <caption>
          Rows {first + 1} to {first + page.row_ids.length} of {page.total}
        </caption>
        <thead>
          <tr aria-rowindex={1}>
            <th scope="col" class="id">Row</th>
            {#each columns as column (column.name)}
              <th
                scope="col"
                class:num={column.kind === 'numeric'}
                title={column.name}>{column.name}</th
              >
            {/each}
            {#if target !== null}
              <th scope="col" class="label-col" title={target}>{target}</th>
            {/if}
          </tr>
        </thead>
        <tbody>
          {#each page.row_ids as rowId, index (rowId)}
            {@const info = suspects.get(rowId)}
            {@const drawn =
              info !== undefined &&
              info.state !== 'fixed' &&
              studio.marked.has(rowId)}
            {@const label = rowLabel(rowId, human, studio.proposals)}
            {@const text = chipText(label)}
            <tr
              id={`row-${String(rowId)}`}
              aria-rowindex={first + index + 2}
              class:suspect={drawn && info.state === 'open'}
              class:stetted={drawn && info.state === 'stet'}
              class:selected={studio.selectedRow === rowId}
              class:filtered={studio.filter !== null}
              style:--rank={info?.rank}
              data-rough={(info?.rank ?? 0) % 3}
            >
              <th scope="row" class="id">{rowId}</th>
              {#each columns as column (column.name)}
                {@const value = page.rows[index]?.[column.name]}
                <td
                  class:num={typeof value === 'number'}
                  title={typeof value === 'string' ? value : undefined}
                >
                  {show(value, column.name)}
                </td>
              {/each}
              {#if target !== null}
                <td class="label-col">
                  <div class="cellbox">
                    <button
                      bind:this={cells[index]}
                      type="button"
                      class={`chip chip--${label.kind}`}
                      class:chip--stale={label.kind !== 'human' &&
                        label.kind !== 'unlabelled' &&
                        label.stale}
                      title={rowLabelText(label)}
                      tabindex={index === active ? 0 : -1}
                      aria-haspopup="listbox"
                      aria-disabled={inert(rowId) ? 'true' : undefined}
                      aria-expanded={menuRow === rowId}
                      aria-controls={menuRow === rowId
                        ? 'label-menu'
                        : undefined}
                      onfocus={() => {
                        active = index;
                      }}
                      onclick={() => {
                        if (!inert(rowId)) menuRow = rowId;
                      }}
                      onkeydown={(event) => {
                        onCellKey(event, index, rowId);
                      }}
                      ><span class="visually-hidden">{text.lead}</span><span
                        class="word">{text.word}</span
                      ><span class="visually-hidden">{text.tail}</span></button
                    >
                    {#if mode.kind === 'evaluate' && mode.row === rowId}
                      <span class="note">Evaluation row: label it blind</span>
                    {/if}
                    {#if ruleLines.has(rowId)}
                      <span class="note"
                        >Rule line {ruleLines.get(rowId)} disagrees</span
                      >
                    {/if}
                    {#if drawn}
                      <button
                        type="button"
                        class="mark"
                        class:mark--stet={info.state === 'stet'}
                        tabindex="-1"
                        aria-label={`Show the note for row ${String(rowId)}`}
                        onclick={() => {
                          pick(rowId);
                        }}
                      >
                        {#if info.state === 'stet'}
                          <span class="stet-word">stet</span>
                        {:else}
                          <svg viewBox="0 0 38 20" aria-hidden="true">
                            <path
                              pathLength="1"
                              d="M4 16 C1 7 15 2 15 9 C15 15 6 14 9 8 C12 3 23 7 35 5"
                            />
                          </svg>
                        {/if}
                      </button>
                    {/if}
                  </div>
                  {#if info?.state === 'open'}
                    <span class="visually-hidden"
                      >Check: model says {info.suspect.likely}</span
                    >
                  {/if}
                  {#if menuRow === rowId}
                    <LabelMenu
                      id="label-menu"
                      {rowId}
                      {classes}
                      current={human[String(rowId)] ?? null}
                      onpick={(picked: string | null) => {
                        closeMenu(index, picked);
                      }}
                      oncancel={() => {
                        closeMenu(index);
                      }}
                      onleave={() => {
                        menuRow = null;
                      }}
                    />
                  {/if}
                </td>
              {/if}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <nav aria-label="Table pages">
      <button
        type="button"
        class="button"
        disabled={page.page === 0}
        onclick={() => {
          showPage(page.page - 1);
        }}
      >
        Previous page
      </button>
      <button
        type="button"
        class="button"
        disabled={first + page.size >= page.total}
        onclick={() => {
          showPage(page.page + 1);
        }}
      >
        Next page
      </button>
      <span class="where"
        >Rows {first + 1} to {first + page.row_ids.length} of {page.total}</span
      >
    </nav>
  {/if}
</section>

<style>
  .sheet {
    --header-height: 2.25rem;
    --rough-0: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 10' preserveAspectRatio='none'%3E%3Cpath d='M0 .4 L96 .2 L98.6 1.6 L97 3 L99.6 4.6 L97.8 6 L99.2 7.6 L96.5 8.8 L97.4 9.7 L0 9.6Z'/%3E%3C/svg%3E");
    --rough-1: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 10' preserveAspectRatio='none'%3E%3Cpath d='M0 .2 L97.5 .6 L99 2.2 L96.8 3.8 L98.4 5.2 L99.8 6.8 L97 8.2 L98.8 9.8 L0 9.5Z'/%3E%3C/svg%3E");
    --rough-2: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 10' preserveAspectRatio='none'%3E%3Cpath d='M0 .5 L95 .3 L97.6 2 L99.2 3.4 L96.4 5 L98.6 6.6 L96 8 L98 9.6 L0 9.8Z'/%3E%3C/svg%3E");
    grid-area: table;
    background: var(--sheet);
    border: 2px solid var(--ink);
    border-right: 1px solid var(--ink);
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }
  .note-line {
    padding: var(--space-3) var(--space-4);
    font-weight: 600;
    color: var(--ink-2);
  }
  .refit {
    padding: var(--space-2) var(--space-4) 0;
    font-size: var(--step--1);
    font-weight: 600;
    color: var(--ink-2);
  }
  .filter-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    background: var(--ink);
    color: var(--on-ink);
    padding: var(--space-2) var(--space-3);
    font-weight: 600;
  }
  .filter-bar .button {
    color: var(--ink);
  }
  .scroll {
    overflow: auto;
    flex: 1;
    min-height: 0;
    scrollbar-gutter: stable;
    /* Rows stop under the header, never half-cut beneath it. */
    scroll-snap-type: y proximity;
    scroll-padding-top: var(--header-height);
  }
  tbody tr {
    scroll-snap-align: start;
  }
  table {
    border-collapse: separate;
    border-spacing: 0;
    width: 100%;
    min-width: max-content;
    font-family: var(--font-data);
    font-size: var(--step--1);
    font-variant-numeric: tabular-nums;
  }
  caption {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  th,
  td {
    padding: 0.42rem 0.9rem;
    text-align: left;
    white-space: nowrap;
    border-bottom: 1px solid var(--line);
    background: var(--sheet);
  }
  td:not(.num):not(.label-col) {
    max-width: 22ch;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  thead th {
    position: sticky;
    top: 0;
    z-index: 3;
    background: var(--ink);
    color: var(--on-ink);
    font-weight: 600;
    border-bottom: 0;
    height: var(--header-height);
    padding-block: 0;
    box-shadow: 0 -1px 0 var(--ink);
  }
  .num {
    text-align: right;
  }
  .id {
    position: sticky;
    left: 0;
    z-index: 1;
    color: var(--ink-3);
    font-weight: 500;
    text-align: right;
    border-right: 1px solid var(--line);
  }
  thead .id {
    z-index: 4;
    color: var(--on-ink-quiet);
    border-right: 0;
  }
  .label-col {
    position: sticky;
    right: 0;
    z-index: 1;
    min-width: 11rem;
    border-left: 1px solid var(--line);
    font-family: var(--font-ui);
  }
  thead .label-col {
    z-index: 4;
    font-family: var(--font-data);
    border-left: 0;
  }
  tbody tr:hover > * {
    background: var(--sheet-quiet);
  }
  .cellbox {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  /* A label is its class and nothing else; the outline says a person gave it. */
  .chip {
    appearance: none;
    cursor: pointer;
    font-family: var(--font-ui);
    font-size: var(--step--1);
    font-weight: 600;
    line-height: 1.1;
    padding: 0.26rem 0.55rem;
    border-radius: 4px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--ink);
    max-width: 14rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    vertical-align: middle;
  }
  .chip--human {
    border-color: var(--edge);
  }
  .chip--proposed {
    color: var(--ink-2);
    font-weight: 500;
    font-style: italic;
  }
  .chip--unsure {
    border-style: dashed;
    border-color: var(--edge);
    color: var(--ink-2);
    font-weight: 500;
  }
  .chip--unlabelled {
    color: var(--ink-3);
  }
  .chip--unlabelled::before {
    content: '—';
  }
  .chip--stale {
    opacity: 0.8;
  }
  .chip[aria-disabled='true'] {
    cursor: default;
    opacity: 0.55;
  }
  .word {
    position: relative;
  }
  .note {
    font-family: var(--font-ui);
    font-size: var(--step--1);
    color: var(--ink-2);
  }
  nav {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-top: 1px solid var(--line);
  }
  .where {
    margin-left: auto;
    font-size: var(--step--1);
    color: var(--ink-2);
    font-variant-numeric: tabular-nums;
  }

  /*
   * The marker pass, on transform and opacity only. One stroke is dragged
   * across the row from the left; its edge is ragged, and later strokes are
   * thinner and paler as the marker runs dry. The strike is drawn through the
   * class word, then the proofreader's loop is written in the margin.
   */
  tr {
    --rough: var(--rough-0);
  }
  tr[data-rough='1'] {
    --rough: var(--rough-1);
  }
  tr[data-rough='2'] {
    --rough: var(--rough-2);
  }
  tr.suspect {
    position: relative;
  }
  tr.suspect::after {
    content: '';
    position: absolute;
    inset: calc(1px + var(--rank, 0) * 0.8px) 0;
    background: var(--mark-stroke);
    mix-blend-mode: multiply;
    opacity: calc(0.95 - var(--rank, 0) * 0.04);
    -webkit-mask: var(--rough) center / 100% 100% no-repeat;
    mask: var(--rough) center / 100% 100% no-repeat;
    pointer-events: none;
    z-index: 2;
    transform-origin: left center;
    animation: stroke var(--sweep-ms) cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }
  tr.suspect .word::after {
    content: '';
    position: absolute;
    left: -2px;
    right: -2px;
    top: 52%;
    height: 2.5px;
    background: var(--mark-text);
    transform-origin: left center;
    animation: strike 220ms cubic-bezier(0.6, 0, 0.2, 1) 220ms both;
  }
  tr.suspect > .id {
    color: var(--ink);
    font-weight: 700;
  }
  tr.selected > * {
    box-shadow:
      inset 0 2px 0 var(--ink),
      inset 0 -2px 0 var(--ink);
  }
  tr.filtered > .id {
    box-shadow: inset 4px 0 0 var(--ink);
  }
  .mark {
    appearance: none;
    background: transparent;
    border: 0;
    padding: 0;
    cursor: pointer;
    color: var(--mark-text);
    line-height: 0;
  }
  .mark svg {
    width: 2.3rem;
    height: 1.2rem;
    overflow: visible;
  }
  .mark path {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-dasharray: 1;
    animation: scribble 380ms cubic-bezier(0.5, 0, 0.2, 1) 260ms both;
  }
  .stet-word {
    font-family: var(--font-ui);
    font-style: italic;
    font-size: var(--step--1);
    font-weight: 700;
    color: var(--ink);
    border-bottom: 2px dotted var(--ink);
    animation: note-in 220ms ease-out both;
  }
  @keyframes stroke {
    from {
      transform: scaleX(0);
    }
  }
  @keyframes strike {
    from {
      transform: scaleX(0);
    }
  }
  @keyframes scribble {
    from {
      stroke-dashoffset: 1;
    }
  }
  @keyframes note-in {
    from {
      opacity: 0;
    }
  }

  @media (max-width: 62rem) {
    .sheet {
      border-right: 2px solid var(--ink);
      height: min(72dvh, 40rem);
    }
    .label-col {
      min-width: 8.5rem;
    }
    th,
    td {
      padding-inline: 0.6rem;
    }
  }
</style>
