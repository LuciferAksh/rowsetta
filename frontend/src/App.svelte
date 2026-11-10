<script lang="ts">
  import { createBackend } from './backend/http';
  import { Studio } from './state.svelte';
  import TableView from './TableView.svelte';

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
  {:else if !studio.workspace.loaded}
    <p>No table is loaded.</p>
  {:else}
    <TableView {studio} />
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
