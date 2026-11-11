import type { ByRow, Suspect } from './backend/types';

/** A short list to work through; the rest are more plausible than these. */
export const SUSPECTS_SHOWN = 10;

/** `open` still carries the flagged label; `stet` was let stand; `fixed` was relabelled. */
export type SuspectState = 'open' | 'stet' | 'fixed';

export interface ShownSuspect {
  suspect: Suspect;
  /** 0 is the least plausible label. */
  rank: number;
  state: SuspectState;
}

/** The shown suspects by row, each with its rank and what became of it. */
export function shownSuspects(
  suspects: readonly Suspect[] | null,
  human: ByRow<string>,
  kept: ReadonlySet<number>,
): ReadonlyMap<number, ShownSuspect> {
  const shown = new Map<number, ShownSuspect>();
  (suspects ?? []).slice(0, SUSPECTS_SHOWN).forEach((suspect, rank) => {
    const unchanged = human[String(suspect.row_id)] === suspect.given;
    const state: SuspectState = !unchanged
      ? 'fixed'
      : kept.has(suspect.row_id)
        ? 'stet'
        : 'open';
    shown.set(suspect.row_id, { suspect, rank, state });
  });
  return shown;
}
