<script lang="ts">
  import type { LeakHint } from './backend/types';
  import type { Studio } from './state.svelte';

  let { studio }: { studio: Studio } = $props();

  const refitGeneration = $derived(studio.workspace?.refit_generation ?? null);
  const excluded = $derived(studio.workspace?.excluded_columns ?? []);

  // A column can fail more than one check; it is listed once with every reason.
  const byColumn = $derived(
    studio.leaks.reduce((columns, hint) => {
      columns.set(hint.column, [...(columns.get(hint.column) ?? []), hint]);
      return columns;
    }, new Map<string, LeakHint[]>()),
  );

  $effect(() => {
    if (refitGeneration !== null) void studio.checkLeaks();
  });
</script>

<section aria-labelledby="leak-heading">
  <h2 id="leak-heading">Columns that may leak the answer</h2>
  <p>
    These checks catch identifiers and near-copies of the label, not every
    column recorded after the outcome. They run once 30 rows have human labels.
  </p>
  {#if byColumn.size === 0}
    <p>No column flagged.</p>
  {:else}
    <ul>
      {#each byColumn as [column, hints] (column)}
        {@const isExcluded = excluded.includes(column)}
        <li>
          {#if isExcluded}
            <s>{column}</s> (excluded)
          {:else}
            {column}
          {/if}
          <ul>
            {#each hints as hint (hint.kind)}
              <li>{hint.reason}</li>
            {/each}
          </ul>
          <button
            type="button"
            onclick={() => {
              void studio.exclude(column, !isExcluded);
            }}
          >
            {isExcluded ? 'Include' : 'Exclude'} column {column}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>
