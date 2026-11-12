<script lang="ts">
  import { createBackend } from './backend/http';
  import { createBrowserBackend } from './backend/browser';
  import { BROWSER, LITE_MODEL } from './browser/config';
  import LoadPanel from './LoadPanel.svelte';
  import EvalPanel from './EvalPanel.svelte';
  import ExportPanel from './ExportPanel.svelte';
  import KeySheet from './KeySheet.svelte';
  import Interchange from './Interchange.svelte';
  import LeakList from './LeakList.svelte';
  import { Studio } from './state.svelte';
  import TableView from './TableView.svelte';
  import TargetPicker from './TargetPicker.svelte';
  import './styles/base.css';

  const studio = new Studio(BROWSER ? createBrowserBackend() : createBackend());
  const failure = $derived(studio.problem ?? studio.workspace?.failure ?? null);
  const workspace = $derived(studio.workspace);
  const loaded = $derived(workspace?.loaded ?? false);
  const refitting = $derived(
    studio.refit !== null ||
      (workspace !== null &&
        workspace.target !== null &&
        workspace.refit_generation !== workspace.generation &&
        Object.keys(workspace.missing).length === 0),
  );
  // Fixed states for design review exist only in the dev server.
  const fixture =
    import.meta.env.DEV && typeof location !== 'undefined'
      ? new URLSearchParams(location.search).get('state')
      : null;

  $effect(() => {
    if (fixture !== null) {
      void import('./fixtures').then((module) => {
        module.applyFixture(studio, fixture);
      });
      return;
    }
    return studio.start();
  });
</script>

<header class="appbar">
  <h1 class="wordmark">Rowsetta</h1>
  {#if BROWSER}<span>{LITE_MODEL}</span>{/if}
  {#if workspace !== null && loaded}
    <p class="facts">
      <span class="file">{studio.fileName ?? 'demo table'}</span>
      {#if workspace.target !== null}
        <span>target: {workspace.target}</span>
      {/if}
      {#if studio.rowCount !== null}
        <span class="quiet">{studio.rowCount} rows</span>
      {/if}
      {#if workspace.target !== null}
        <span class="state quiet" class:state--busy={refitting}>
          model {refitting ? 'updating' : 'up to date'}
        </span>
      {/if}
    </p>
  {:else}
    <p class="facts"></p>
  {/if}
  {#if workspace !== null}
    <button
      type="button"
      class="pill-button"
      aria-keyshortcuts="?"
      onclick={() => {
        studio.keySheetOpen = true;
      }}
    >
      <span class="pill-long">Shortcuts</span><kbd class="pill-key">?</kbd>
    </button>
  {/if}
</header>

<main class="shell" class:shell--bare={workspace !== null && !loaded}>
  {#if BROWSER}<LoadPanel />{/if}
  {#if failure !== null}
    <div role="alert" class="alert">
      <p class="what">{failure.error}</p>
      <p class="next">{failure.next_step}</p>
    </div>
  {/if}
  {#if workspace === null}
    <div class="stage">
      <progress class="runner" aria-label="Connecting"></progress>
      <p>
        {BROWSER
          ? 'Loading the bundled table.'
          : 'Connecting to the local server.'}
      </p>
    </div>
  {:else}
    {#if loaded && workspace.target !== null}
      <Interchange {studio} />
    {/if}
    <TargetPicker {studio} />
    {#if loaded}
      <!-- Above the table in reading order, so a filter that shortens the table
      never moves a line under a resting pointer and changes the filter again. -->
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
