<script lang="ts">
  import { runtimeLoading } from './browser/loading.svelte';
</script>

<aside class="panel" aria-label="Browser runtime">
  <p>
    Nothing leaves this page. The lite model needs no model-weight download.
  </p>
  {#if !runtimeLoading.ready}
    <label>
      Runtime: {runtimeLoading.done.toLocaleString()} / {runtimeLoading.total.toLocaleString()}
      bytes
      <progress max={runtimeLoading.total || 1} value={runtimeLoading.done}
      ></progress>
    </label>
    <p>Label rows now; your labels are kept while the runtime loads.</p>
  {:else}
    <p>Browser runtime ready.</p>
  {/if}
</aside>
