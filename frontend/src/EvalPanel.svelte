<script lang="ts">
  import { evaluationText, recallText } from './evaluation';
  import type { Studio } from './state.svelte';

  let { studio }: { studio: Studio } = $props();

  // Confidence is a probability, so the slider covers 0 to 1 in 5-point steps.
  const THRESHOLD_STEP = 0.05;

  const workspace = $derived(studio.workspace);
  const evaluation = $derived(workspace?.evaluation ?? null);
  const mode = $derived(studio.mode);
  const unsureCount = $derived(studio.proposals.unsure.size);
</script>

<section aria-labelledby="eval-heading">
  <h2 id="eval-heading">Accuracy</h2>
  <p>
    {#if mode.kind === 'label'}
      Evaluation rows are served at random and labelled without seeing a
      proposal.
    {:else if mode.row === null}
      Every row without a human label has been served for evaluation.
    {:else}
      Evaluating row {mode.row}: give it the label you know is right.
    {/if}
  </p>
  <button
    type="button"
    aria-keyshortcuts="e"
    onclick={() => {
      void studio.toggleEvaluation();
    }}
  >
    {mode.kind === 'label' ? 'Evaluate (e)' : 'Stop evaluating (e)'}
  </button>
  {#each evaluationText(evaluation, workspace?.eval_count ?? 0) as sentence (sentence)}
    <p>{sentence}</p>
  {/each}
  {#if evaluation !== null}
    <ul aria-label="Recall per class">
      {#each Object.entries(evaluation.per_class_recall) as [label, recall] (label)}
        <li>{recallText(label, recall)}</li>
      {/each}
    </ul>
    <p>
      Measured on rows that had no human label when served. Teaching moves hard
      rows to human labels, so the filled column is likely at least this
      accurate.
    </p>
  {/if}

  <h3>Unsure proposals</h3>
  <label>
    Confidence threshold
    <input
      type="range"
      min="0"
      max="1"
      step={THRESHOLD_STEP}
      value={workspace?.threshold ?? 0}
      onchange={(event) => {
        void studio.setThreshold(Number(event.currentTarget.value));
      }}
    />
  </label>
  <p>
    Threshold {(workspace?.threshold ?? 0).toFixed(2)}: {unsureCount} rows below it
    are marked unsure.
  </p>
</section>
