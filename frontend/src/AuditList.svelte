<script lang="ts">
  import type { Studio } from './state.svelte';

  let { studio }: { studio: Studio } = $props();

  // A short list to work through; the rest are more plausible than these.
  const SHOWN = 10;

  const human = $derived(studio.workspace?.human ?? {});
  const shown = $derived(studio.suspects?.slice(0, SHOWN) ?? null);
  const percent = new Intl.NumberFormat('en', {
    style: 'percent',
    maximumFractionDigits: 0,
  });
</script>

<section aria-labelledby="audit-heading">
  <h2 id="audit-heading">Check existing labels</h2>
  <p>
    Each labelled row is scored by the model fitted on the other four fifths of
    the labels, never on itself. The rows whose label it finds least likely come
    first. This is the self-confidence ranking of confident learning (Northcutt,
    Jiang and Chuang, 2021).
  </p>
  <button
    type="button"
    onclick={() => {
      void studio.checkLabels();
    }}
  >
    Check these
  </button>
  {#if shown !== null}
    {#if shown.length === 0}
      <p>No human labels to check.</p>
    {:else}
      <ol>
        {#each shown as suspect (suspect.row_id)}
          {@const current = human[String(suspect.row_id)] ?? null}
          <li>
            <button
              type="button"
              onclick={() => {
                void studio.goToRow(suspect.row_id);
              }}
            >
              Row {suspect.row_id}: labelled {suspect.given}; the model gives
              that {percent.format(suspect.given_probability)} and says {suspect.likely}
            </button>
            {#if current !== suspect.given}
              (now {current ?? 'unlabelled'})
            {/if}
          </li>
        {/each}
      </ol>
    {/if}
  {/if}
</section>
