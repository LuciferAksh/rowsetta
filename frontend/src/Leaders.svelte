<script lang="ts">
  import type { Studio } from './state.svelte';

  let { studio }: { studio: Studio } = $props();

  interface Leader {
    row: number;
    d: string;
    selected: boolean;
  }

  const CURVE_PX = 28;
  let leaders = $state.raw<Leader[]>([]);
  let frame = 0;

  /** A leader joins a row's mark to its slip, only while both are on screen. */
  function measure(): void {
    frame = 0;
    const found: Leader[] = [];
    const scroll = document.querySelector('.scroll')?.getBoundingClientRect();
    const margin = document.querySelector('.slips')?.getBoundingClientRect();
    // Stacked layouts put the margin below the table, where a leader has no side to run across.
    if (scroll && margin && margin.left >= scroll.right - 2) {
      for (const slip of document.querySelectorAll<HTMLElement>(
        '.slip:not(.pending)',
      )) {
        const row = Number(slip.dataset.row);
        const mark = document
          .getElementById(`row-${String(row)}`)
          ?.querySelector('.mark');
        if (!mark) continue;
        const from = mark.getBoundingClientRect();
        const to = slip.getBoundingClientRect();
        const rowY = from.top + from.height / 2;
        const slipY = to.top + Math.min(to.height / 2, 18);
        const rowVisible = rowY > scroll.top + 40 && rowY < scroll.bottom - 4;
        const slipVisible = slipY > margin.top && slipY < margin.bottom;
        if (!rowVisible || !slipVisible) continue;
        const x1 = Math.min(from.right, scroll.right - 2);
        found.push({
          row,
          d: `M${String(x1)} ${String(rowY)} C${String(x1 + CURVE_PX)} ${String(rowY)} ${String(to.left - CURVE_PX)} ${String(slipY)} ${String(to.left)} ${String(slipY)}`,
          selected: studio.selectedRow === row,
        });
      }
    }
    leaders = found;
  }

  function schedule(): void {
    if (frame === 0) frame = requestAnimationFrame(measure);
  }

  $effect(() => {
    // Anything that moves a row or a slip needs a new measurement.
    const deps = [
      studio.marked,
      studio.selectedRow,
      studio.kept,
      studio.page,
      studio.suspects,
    ];
    if (deps.length > 0) schedule();
  });

  $effect(() => {
    addEventListener('scroll', schedule, { capture: true, passive: true });
    addEventListener('resize', schedule);
    const timer = setInterval(schedule, 250);
    return () => {
      removeEventListener('scroll', schedule, { capture: true });
      removeEventListener('resize', schedule);
      clearInterval(timer);
      cancelAnimationFrame(frame);
    };
  });
</script>

<svg class="leaders" aria-hidden="true">
  {#each leaders as leader (leader.row)}
    <path d={leader.d} class:selected={leader.selected} pathLength="1" />
  {/each}
</svg>

<style>
  .leaders {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 5;
    overflow: visible;
  }
  path {
    fill: none;
    stroke: var(--mark-text);
    stroke-width: 1.25;
    stroke-linecap: round;
    stroke-dasharray: 1;
    animation: draw 320ms ease-out both;
  }
  path.selected {
    stroke: var(--ink);
    stroke-width: 2;
  }
  @keyframes draw {
    from {
      stroke-dashoffset: 1;
    }
  }
</style>
