<script lang="ts">
  import { createBackend } from './backend/http';
  import EvalPanel from './EvalPanel.svelte';
  import ExportPanel from './ExportPanel.svelte';
  import KeySheet from './KeySheet.svelte';
  import LeakList from './LeakList.svelte';
  import { Studio } from './state.svelte';
  import TableView from './TableView.svelte';
  import TargetPicker from './TargetPicker.svelte';

  const studio = new Studio(createBackend());
  const failure = $derived(studio.problem ?? studio.workspace?.failure ?? null);

  $effect(() => studio.start());
</script>

<main>
  <h1>Tabular Studio (working title)</h1>
  {#if failure !== null}
    <div role="alert">
      <p>{failure.error}</p>
      <p>{failure.next_step}</p>
    </div>
  {/if}
  {#if studio.workspace === null}
    <p>Connecting to the local server.</p>
  {:else}
    <button
      type="button"
      aria-keyshortcuts="?"
      onclick={() => {
        studio.keySheetOpen = true;
      }}
    >
      Keyboard shortcuts (?)
    </button>
    <TargetPicker {studio} />
    {#if studio.workspace.loaded}
      <!-- Above the table, so a filter that shortens the table never moves a
      line under a resting pointer and changes the filter again. -->
      <ExportPanel {studio} />
      <TableView {studio} />
      <EvalPanel {studio} />
      <LeakList {studio} />
    {/if}
    <KeySheet {studio} />
  {/if}
  <p role="status" class="visually-hidden">
    {#key studio.announcement}{studio.announcement?.text ?? ''}{/key}
  </p>
</main>

<style>
  /* Read by screen readers without taking space on screen. */
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
