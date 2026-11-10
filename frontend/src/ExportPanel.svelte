<script lang="ts">
  import {
    EXPORT_FORMATS,
    SQL_DIALECTS,
    type ExportFormat,
    type SqlDialect,
  } from './backend/types';
  import { DEFAULT_RULE_DEPTH, RULE_DEPTHS } from './rule';
  import RuleView from './RuleView.svelte';
  import type { Studio } from './state.svelte';

  let { studio }: { studio: Studio } = $props();

  const FORMAT_NAMES: Record<ExportFormat, string> = {
    sql: 'SQL',
    dbt: 'dbt',
    python: 'Python',
    json: 'JSON',
  };
  const DIALECT_NAMES: Record<SqlDialect, string> = {
    duckdb: 'DuckDB',
    postgres: 'PostgreSQL',
    sqlite: 'SQLite',
  };
  const COPY_REFUSED = {
    error: 'The browser did not allow copying.',
    next_step: 'Select the text and copy it with Ctrl+C or Cmd+C.',
  };

  let depth = $state(DEFAULT_RULE_DEPTH);
  const query = $derived(studio.exportQuery);
  const exported = $derived(studio.exported);
  const files = $derived(
    exported === null
      ? []
      : exported.format === 'dbt'
        ? Object.entries(exported.files)
        : [[FORMAT_NAMES[exported.format], exported.text] as const],
  );

  async function copy(name: string, text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      studio.announcement = { text: `Copied ${name}` };
    } catch {
      studio.problem = COPY_REFUSED;
    }
  }
</script>

<section aria-labelledby="export-heading">
  <h2 id="export-heading">Export</h2>
  <label>
    Tree depth
    <select bind:value={depth}>
      {#each RULE_DEPTHS as option (option)}
        <option value={option}>{option}</option>
      {/each}
    </select>
  </label>
  <button
    type="button"
    onclick={() => {
      void studio.exportRule(depth);
    }}
  >
    Export rule
  </button>
  <RuleView {studio} />
  {#if studio.certificate.length > 0}
    <h3>Certificate</h3>
    <ul aria-label="Certificate">
      {#each studio.certificate as figure, index (index)}
        <li>{figure}</li>
      {/each}
    </ul>
  {/if}
  {#if exported !== null}
    <fieldset>
      <legend>Format</legend>
      {#each EXPORT_FORMATS as format (format)}
        <label>
          <input
            type="radio"
            name="export-format"
            value={format}
            checked={query.format === format}
            onchange={() => {
              void studio.showExport({ ...query, format });
            }}
          />
          {FORMAT_NAMES[format]}
        </label>
      {/each}
    </fieldset>
    {#if query.format === 'sql' || query.format === 'dbt'}
      <fieldset>
        <legend>Dialect</legend>
        {#each SQL_DIALECTS as dialect (dialect)}
          <label>
            <input
              type="radio"
              name="export-dialect"
              value={dialect}
              checked={query.dialect === dialect}
              onchange={() => {
                void studio.showExport({ ...query, dialect });
              }}
            />
            {DIALECT_NAMES[dialect]}
          </label>
        {/each}
      </fieldset>
    {/if}
    {#each files as [name, text] (name)}
      <h3>{name}</h3>
      <pre>{text}</pre>
      <button
        type="button"
        onclick={() => {
          void copy(name, text);
        }}
      >
        Copy {name}
      </button>
    {/each}
  {/if}
</section>
