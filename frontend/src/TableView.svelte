<script lang="ts">
  import { tick, untrack } from 'svelte';
  import type { Cell } from './backend/types';
  import LabelMenu from './LabelMenu.svelte';
  import {
    missingText,
    rowLabel,
    rowLabelText,
    tableCommand,
  } from './labelling';
  import { disagreements } from './rule';
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
  const ruleLines = $derived(
    disagreements(studio.rule?.leaf_summary ?? [], human, studio.proposals),
  );

  // Roving focus: only the active row's label cell is in the tab order.
  let active = $state(0);
  let menuRow = $state<number | null>(null);
  const cells: (HTMLButtonElement | null)[] = [];

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

<section aria-labelledby="table-heading">
  <h2 id="table-heading">Rows</h2>
  {#if target === null}
    <p>Choose a target column to start labelling.</p>
  {:else if missing !== ''}
    <p>{missing}</p>
  {/if}
  {#if studio.refit !== null}
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
    <p>
      {studio.filter.description}.
      <button
        type="button"
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
    <table aria-rowcount={page.total + 1}>
      <caption>
        Rows {first + 1} to {first + page.row_ids.length} of {page.total}
      </caption>
      <thead>
        <tr aria-rowindex={1}>
          <th scope="col">Row</th>
          {#each columns as column (column.name)}
            <th scope="col">{column.name}</th>
          {/each}
          {#if target !== null}
            <th scope="col">{target}</th>
          {/if}
        </tr>
      </thead>
      <tbody>
        {#each page.row_ids as rowId, index (rowId)}
          <tr aria-rowindex={first + index + 2}>
            <th scope="row">{rowId}</th>
            {#each columns as column (column.name)}
              <td>{display(page.rows[index]?.[column.name])}</td>
            {/each}
            {#if target !== null}
              <td>
                <button
                  bind:this={cells[index]}
                  type="button"
                  tabindex={index === active ? 0 : -1}
                  aria-haspopup="listbox"
                  aria-disabled={inert(rowId) ? 'true' : undefined}
                  aria-expanded={menuRow === rowId}
                  aria-controls={menuRow === rowId ? 'label-menu' : undefined}
                  onfocus={() => {
                    active = index;
                  }}
                  onclick={() => {
                    if (!inert(rowId)) menuRow = rowId;
                  }}
                  onkeydown={(event) => {
                    onCellKey(event, index, rowId);
                  }}
                >
                  {rowLabelText(rowLabel(rowId, human, studio.proposals))}
                </button>
                {#if mode.kind === 'evaluate' && mode.row === rowId}
                  <span>Evaluation row: label it blind</span>
                {/if}
                {#if ruleLines.has(rowId)}
                  <span>Rule line {ruleLines.get(rowId)} disagrees</span>
                {/if}
                {#if menuRow === rowId}
                  <LabelMenu
                    id="label-menu"
                    {rowId}
                    {classes}
                    current={human[String(rowId)] ?? null}
                    onpick={(label: string | null) => {
                      closeMenu(index, label);
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
    <nav aria-label="Table pages">
      <button
        type="button"
        disabled={page.page === 0}
        onclick={() => {
          showPage(page.page - 1);
        }}
      >
        Previous page
      </button>
      <button
        type="button"
        disabled={first + page.size >= page.total}
        onclick={() => {
          showPage(page.page + 1);
        }}
      >
        Next page
      </button>
    </nav>
  {/if}
</section>
