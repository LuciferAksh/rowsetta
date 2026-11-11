<script lang="ts">
  import type { Studio } from './state.svelte';

  let { studio }: { studio: Studio } = $props();

  // Mirror MIN_CLASSES and MAX_CLASSES in src/tabular_studio/core/session.py.
  const MIN_CLASSES = 2;
  const MAX_CLASSES = 10;

  const workspace = $derived(studio.workspace);
  const target = $derived(workspace?.target ?? null);
  const humanCount = $derived(Object.keys(workspace?.human ?? {}).length);
  const columns = $derived(studio.page?.columns ?? []);

  let chosenFile = $state<string | null>(null);
  let column = $state<string | undefined>(undefined);
  let newName = $state('');
  let newClasses = $state('');
  let classProblem = $state<string | null>(null);
  /** Set after a column's values become labels, so the rows left out can be counted. */
  let prefilled = $state<{ column: string; unlabelled: number } | null>(null);

  async function open(files: FileList | null | undefined): Promise<void> {
    const file = files?.[0];
    if (file === undefined) return;
    prefilled = null;
    await studio.upload(file);
    if (studio.problem === null) chosenFile = file.name;
  }

  async function useColumn(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const chosen = column ?? columns[0]?.name;
    if (chosen === undefined) return;
    await studio.chooseTarget({ target: chosen });
    const total = studio.rowCount;
    prefilled =
      studio.problem === null && total !== null
        ? { column: chosen, unlabelled: total - humanCount }
        : null;
  }

  function createTarget(event: SubmitEvent): void {
    event.preventDefault();
    const classes = [
      ...new Set(
        newClasses
          .split(',')
          .map((name) => name.trim())
          .filter((name) => name !== ''),
      ),
    ];
    if (classes.length < MIN_CLASSES || classes.length > MAX_CLASSES) {
      classProblem = `Name ${String(MIN_CLASSES)} to ${String(MAX_CLASSES)} different classes, separated by commas.`;
      return;
    }
    classProblem = null;
    prefilled = null;
    void studio.chooseTarget({ target: newName.trim(), classes });
  }

  function teachFromScratch(): void {
    if (target === null || workspace === null) return;
    prefilled = null;
    void studio.chooseTarget({ target, classes: workspace.classes });
  }
</script>

<section class="panel panel--target" aria-labelledby="target-heading">
  <h2 id="target-heading">Table and target</h2>
  {#if workspace?.loaded !== true}
    <p class="lede">
      Open a CSV, label a few rows, and keep a rule that labels the rest. The
      table stays on this machine.
    </p>
  {/if}
  <div
    class="drop"
    role="group"
    aria-labelledby="drop-heading"
    ondragover={(event) => {
      event.preventDefault();
    }}
    ondrop={(event) => {
      event.preventDefault();
      void open(event.dataTransfer?.files);
    }}
  >
    <h3 id="drop-heading">Open a CSV</h3>
    <label>
      Choose or drop a CSV file
      <input
        type="file"
        accept=".csv,text/csv"
        onchange={(event) => {
          void open(event.currentTarget.files);
        }}
      />
    </label>
    {#if chosenFile === null}
      <p class="hint">
        Numbers and categories are used; free-text columns are skipped.
      </p>
    {:else}
      <p class="hint">Opened {chosenFile}.</p>
    {/if}
  </div>

  {#if workspace?.loaded === true}
    {#if target !== null}
      <p class="target-line">
        Target: {target} ({workspace.classes.join(', ')}). {humanCount} human labels.
      </p>
    {/if}
    {#if prefilled !== null}
      <p class="hint">
        Took the labels from {prefilled.column}; {prefilled.unlabelled} rows with
        no value stay unlabelled.
      </p>
    {/if}
    {#if target !== null && humanCount > 0}
      <button type="button" class="button" onclick={teachFromScratch}>
        Clear all and teach from scratch
      </button>
    {/if}

    <form class="stack" onsubmit={useColumn}>
      <label>
        Existing column
        <select bind:value={column}>
          <option value={undefined} disabled>Choose a column</option>
          {#each columns as option (option.name)}
            <option value={option.name}>{option.name} ({option.kind})</option>
          {/each}
        </select>
      </label>
      <button type="submit" class="button">Use its values as labels</button>
    </form>

    <form class="stack" onsubmit={createTarget}>
      <label>
        New target name
        <input type="text" required bind:value={newName} />
      </label>
      <label>
        Classes, separated by commas
        <input
          type="text"
          required
          bind:value={newClasses}
          aria-describedby={classProblem === null ? undefined : 'class-problem'}
        />
      </label>
      {#if classProblem !== null}
        <p id="class-problem" class="field-error">{classProblem}</p>
      {/if}
      <button type="submit" class="button button-solid">Create target</button>
    </form>
  {/if}
</section>

<style>
  .drop {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border: 2px dashed var(--edge);
    background: var(--sheet-quiet);
  }
  .drop:hover,
  .drop:focus-within {
    border-color: var(--ink);
  }
  .drop h3 {
    font-size: var(--step-0);
  }
  .stack {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
    gap: var(--space-2) var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px solid var(--line);
  }
  .stack > :global(p) {
    grid-column: 1 / -1;
  }
  .stack:has(input[type='text']) label:first-of-type,
  .stack:has(input[type='text']) .field-error {
    grid-column: 1 / -1;
  }
  .target-line {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .field-error {
    color: var(--ink);
    font-weight: 600;
    font-size: var(--step--1);
  }
  .lede {
    color: var(--ink-2);
    font-size: var(--step-1);
    line-height: 1.4;
  }
</style>
