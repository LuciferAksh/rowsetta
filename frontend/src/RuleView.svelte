<script lang="ts">
  import type { LeafLine } from './backend/types';
  import { lineFilter, ruleLineText } from './rule';
  import type { Studio } from './state.svelte';

  let { studio }: { studio: Studio } = $props();

  const rule = $derived(studio.rule);
  const stale = $derived(
    rule !== null && rule.generation !== studio.workspace?.generation,
  );

  function show(line: LeafLine): void {
    void studio.filterRows(lineFilter(line));
  }
</script>

{#if rule !== null}
  <section aria-labelledby="rule-heading">
    <h3 id="rule-heading">Rule</h3>
    {#if stale}
      <p>Labels changed since this rule was fitted.</p>
    {/if}
    <p>Focus a line to show its rows in the table; Escape shows every row.</p>
    <ol>
      {#each rule.leaf_summary as line (line.line_no)}
        <li>
          <button
            type="button"
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
            Line {line.line_no}: {ruleLineText(line)}
          </button>
        </li>
      {/each}
    </ol>
  </section>
{/if}
