<script lang="ts">
  import type { LeafLine } from './backend/types';
  import { columnDecimals, lineFilter, ruleLineParts } from './rule';
  import type { Studio } from './state.svelte';

  let { studio }: { studio: Studio } = $props();

  const rule = $derived(studio.rule);
  const decimals = $derived(columnDecimals(studio.page?.rows ?? []));
  const stale = $derived(
    rule !== null && rule.generation !== studio.workspace?.generation,
  );

  function show(line: LeafLine): void {
    void studio.filterRows(lineFilter(line));
  }
</script>

{#if rule !== null}
  <section class="rule" aria-labelledby="rule-heading">
    <h3 id="rule-heading">Rule</h3>
    {#if stale}
      <p class="stale">Labels changed since this rule was fitted.</p>
    {/if}
    <p class="hint">
      Focus a line to show its rows in the table; Escape shows every row.
    </p>
    <ol>
      {#each rule.leaf_summary as line (line.line_no)}
        {@const parts = ruleLineParts(line, decimals)}
        <li>
          <button
            type="button"
            class="line"
            class:abstains={line.label === null}
            onfocus={() => {
              show(line);
            }}
            onmouseenter={() => {
              show(line);
            }}
            onclick={() => {
              show(line);
            }}
            onkeydown={(event) => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              void studio.filterRows(null);
            }}
          >
            <span class="no">Line {line.line_no}:</span>
            <span class="when">{parts.conditions}</span>
            <span class="arrow">→</span>
            {#if parts.answer === null}
              <span class="then">no answer (rule unsure)</span>
            {:else}
              <span class="then">{parts.answer}</span>
            {/if}
            <span class="visually-hidden">: </span>
            <span class="stats">
              {parts.rows}{#if parts.answer !== null}, {parts.agreeing}{/if}
            </span>
          </button>
        </li>
      {/each}
    </ol>
  </section>
{/if}

<style>
  .rule {
    display: grid;
    gap: var(--space-2);
  }
  .rule h3 {
    font-size: var(--step-0);
    font-weight: 700;
  }
  .stale {
    font-weight: 700;
    color: var(--ink);
  }
  ol {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    border: 2px solid var(--ink);
  }
  ol li {
    max-width: none;
  }
  li + li {
    border-top: 1px solid var(--ink);
  }
  .line {
    appearance: none;
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-areas:
      'no when'
      'no then'
      'no stats';
    column-gap: var(--space-3);
    row-gap: 2px;
    width: 100%;
    text-align: left;
    background: var(--sheet);
    border: 0;
    padding: var(--space-3);
    cursor: pointer;
    transition:
      background var(--lift-ms),
      color var(--lift-ms);
  }
  .line:hover,
  .line:focus-visible {
    background: var(--ink);
    color: var(--on-ink);
  }
  .line:focus-visible {
    outline-offset: -4px;
    outline-color: var(--on-ink);
    box-shadow: none;
  }
  .no {
    grid-area: no;
    font-family: var(--font-data);
    font-size: var(--step--1);
    font-weight: 700;
    align-self: start;
    padding-top: 0.15rem;
    color: var(--ink-3);
    min-width: 5.2ch;
  }
  .line:hover .no,
  .line:focus-visible .no {
    color: var(--on-ink-quiet);
  }
  .when {
    grid-area: when;
    font-family: var(--font-data);
    font-size: var(--step--1);
    overflow-wrap: anywhere;
  }
  .arrow {
    display: none;
  }
  .then {
    grid-area: then;
    justify-self: start;
    font-size: var(--step-1);
    font-weight: 800;
    letter-spacing: -0.01em;
    padding: 0 0.4rem;
    margin: 2px 0;
    background: var(--ink);
    color: var(--on-ink);
    max-width: 100%;
    overflow-wrap: anywhere;
  }
  .line:hover .then,
  .line:focus-visible .then {
    background: var(--on-ink);
    color: var(--ink);
  }
  .abstains .then {
    background: transparent;
    color: var(--ink-2);
    border: 1.5px dashed var(--edge);
    font-size: var(--step-0);
    font-weight: 600;
  }
  .line:hover.abstains .then,
  .line:focus-visible.abstains .then {
    background: transparent;
    color: var(--on-ink);
    border-color: var(--on-ink-quiet);
  }
  .stats {
    grid-area: stats;
    font-size: var(--step--1);
    color: var(--ink-2);
  }
  .line:hover .stats,
  .line:focus-visible .stats {
    color: var(--on-ink-quiet);
  }
</style>
