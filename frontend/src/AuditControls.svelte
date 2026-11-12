<script lang="ts">
  import { BROWSER } from './browser/config';
  let {
    hasSuspects,
    hasShown,
    hasRule,
    checking,
    oncheck,
  }: {
    hasSuspects: boolean;
    hasShown: boolean;
    hasRule: boolean;
    checking: boolean;
    oncheck: () => Promise<void>;
  } = $props();
</script>

{#if hasSuspects && hasShown}
  <div class="acts">
    <button
      type="button"
      class="button"
      disabled={checking}
      onclick={() => {
        void oncheck();
      }}>Check again</button
    >
  </div>
{:else if !BROWSER && hasRule && !checking && !hasSuspects}
  <div class="acts">
    <button
      type="button"
      class="button button-solid"
      onclick={() => {
        void oncheck();
      }}>Check the labels</button
    >
  </div>
{/if}

<style>
  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
</style>
