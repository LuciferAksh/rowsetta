<script lang="ts">
  import { shownSuspects } from './audit';
  import type { Studio } from './state.svelte';

  let { studio }: { studio: Studio } = $props();

  const human = $derived(studio.workspace?.human ?? {});
  const shown = $derived(
    studio.suspects === null
      ? null
      : // In table order, so a leader from a row to its slip never crosses another.
        [...shownSuspects(studio.suspects, human, studio.kept).values()].sort(
          (a, b) => a.suspect.row_id - b.suspect.row_id,
        ),
  );
  /** A diff stat: how many labels would move from each class to which. */
  const tally = $derived.by(() => {
    const counts: Record<string, number> = {};
    for (const { suspect } of shown ?? []) {
      const key = `${suspect.given} → ${suspect.likely}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return Object.entries(counts).sort((x, y) => y[1] - x[1]);
  });
  const percent = new Intl.NumberFormat('en', {
    style: 'percent',
    maximumFractionDigits: 0,
  });

  /** Join a slip to its row: select both, and bring the row to the middle of the table. */
  async function open(rowId: number): Promise<void> {
    studio.selectedRow = rowId;
    await studio.goToRow(rowId);
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    document
      .getElementById(`row-${String(rowId)}`)
      ?.scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' });
  }
</script>

<section class="margin" aria-labelledby="audit-heading">
  <div class="head">
    <h2 id="audit-heading">Check existing labels</h2>
    <button
      type="button"
      class="button button-solid"
      onclick={() => {
        void studio.checkLabels();
      }}
    >
      Check these
    </button>
  </div>
  {#if shown === null}
    <p class="hint">
      Every label you gave is scored by a model that never saw its row. The
      least plausible are marked in the table and written up here.
    </p>
    <details class="how">
      <summary>How the score works</summary>
      <p>
        Each labelled row is scored by the model fitted on the other four fifths
        of the labels, never on itself. The rows whose label it finds least
        likely come first. This is the self-confidence ranking of confident
        learning (Northcutt, Jiang and Chuang, 2021).
      </p>
    </details>
  {:else if shown.length === 0}
    <p class="hint">No human labels to check.</p>
  {:else}
    <p class="counter" aria-hidden="true">
      <span class="figure">{studio.marked.size}</span> of {shown.length} marked
    </p>
    <p class="tally">
      {#each tally as [change, count] (change)}
        <span><span class="n">{count}</span> {change}</span>
      {/each}
    </p>
    <p class="hint">
      The figure in brackets is how likely the model finds your label.
    </p>
    <ol class="slips">
      {#each shown as item (item.suspect.row_id)}
        {@const { suspect, state } = item}
        {@const current = human[String(suspect.row_id)] ?? null}
        <li
          id={`slip-${String(suspect.row_id)}`}
          class="slip"
          class:pending={!studio.marked.has(suspect.row_id)}
          class:selected={studio.selectedRow === suspect.row_id}
          data-row={suspect.row_id}
          data-state={state}
          style:--rank={item.rank}
        >
          <button
            type="button"
            class="main"
            onclick={() => {
              void open(suspect.row_id);
            }}
          >
            <span class="row">Row {suspect.row_id}</span>
            <span class="sep">·</span>
            <s>{suspect.given}</s>
            <span class="arrow">→</span>
            <strong>{suspect.likely}</strong>
            <span class="odds"
              >({percent.format(suspect.given_probability)})</span
            >
          </button>
          {#if state === 'fixed'}
            <span class="now">(now {current ?? 'unlabelled'})</span>
          {:else}
            <button
              type="button"
              class="stet"
              aria-pressed={state === 'stet'}
              title="Let this label stand"
              onclick={() => {
                studio.toggleKept(suspect.row_id);
              }}
            >
              stet
            </button>
          {/if}
        </li>
      {/each}
    </ol>
  {/if}
</section>

<style>
  .margin {
    grid-area: margin;
    background: var(--sheet-quiet);
    border: 2px solid var(--ink);
    border-left: 1px solid var(--ink);
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-height: 0;
    min-width: 0;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .head h2 {
    font-size: var(--step-0);
  }
  .how summary {
    cursor: pointer;
    font-size: var(--step--1);
    font-weight: 600;
  }
  .how p {
    margin-top: var(--space-2);
    font-size: var(--step--1);
    color: var(--ink-2);
  }
  .tally {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.75rem;
    margin: 0 0 0.75rem;
    padding: 0;
    list-style: none;
    font-family: var(--font-data);
    font-size: 0.8125rem;
  }
  .tally .n {
    font-weight: 700;
  }
  .counter {
    font-size: var(--step--1);
    font-weight: 600;
    color: var(--ink-2);
    font-variant-numeric: tabular-nums;
  }
  .figure {
    display: inline-block;
    min-width: 1.6ch;
    font-size: var(--step-2);
    font-weight: 800;
    letter-spacing: -0.03em;
    color: var(--ink);
  }
  .slips {
    display: flex;
    flex-direction: column;
    overflow: auto;
    min-height: 0;
    margin: 0 calc(var(--space-4) * -1) calc(var(--space-4) * -1);
    padding: 0 var(--space-4) var(--space-4);
    flex: 1;
  }
  .slip {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    border-top: 1px solid var(--line);
    outline-offset: -2px;
  }
  .slip:last-child {
    border-bottom: 1px solid var(--line);
  }
  .slip.selected {
    outline: 2px solid var(--ink);
    background: var(--sheet);
  }
  .slip.pending {
    display: none;
  }
  .slip:not(.pending) {
    animation: write 360ms cubic-bezier(0.3, 0.7, 0.2, 1) both;
  }
  .main {
    appearance: none;
    flex: 1;
    min-width: 0;
    text-align: left;
    background: transparent;
    border: 0;
    cursor: pointer;
    padding: var(--space-2) var(--space-1);
    line-height: 1.35;
    overflow-wrap: anywhere;
  }
  .main:hover {
    background: var(--sheet);
  }
  .row {
    font-family: var(--font-data);
    font-size: var(--step--1);
    font-weight: 700;
  }
  .sep,
  .arrow {
    color: var(--ink-3);
    margin: 0 0.2ch;
  }
  s {
    text-decoration-line: line-through;
    text-decoration-thickness: 2px;
    text-decoration-color: var(--mark-text);
    color: var(--ink-2);
  }
  strong {
    font-weight: 800;
  }
  .odds {
    font-family: var(--font-data);
    font-size: var(--step--1);
    color: var(--mark-text);
    font-weight: 600;
  }
  .stet {
    appearance: none;
    background: transparent;
    border: 0;
    border-bottom: 1.5px dotted var(--ink-2);
    cursor: pointer;
    font-style: italic;
    font-size: var(--step--1);
    padding: 0 0.1rem;
    margin-right: var(--space-1);
    color: var(--ink-2);
  }
  .stet[aria-pressed='true'] {
    color: var(--ink);
    font-weight: 700;
    border-bottom-style: solid;
  }
  [data-state='stet'] s {
    text-decoration: none;
    color: var(--ink);
  }
  .now {
    font-size: var(--step--1);
    color: var(--ink-2);
    padding-right: var(--space-2);
  }
  [data-state='fixed'] {
    opacity: 0.7;
  }
  @keyframes write {
    from {
      clip-path: inset(0 100% 0 0);
    }
    to {
      clip-path: inset(0);
    }
  }
</style>
