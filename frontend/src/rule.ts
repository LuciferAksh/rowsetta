import type { ByRow, LeafLine } from './backend/types';
import { rowLabel, type ShownProposals } from './labelling';

/** Rows the table narrows to, and the words that say why. */
export interface RowFilter {
  rowIds: readonly number[];
  description: string;
}

export function ruleLineText(line: LeafLine): string {
  const conditions =
    line.conditions.length === 0
      ? 'every row'
      : line.conditions
          .map(([column, operator, value]) => `${column} ${operator} ${value}`)
          .join(' and ');
  const rows = `${String(line.row_ids.length)} rows`;
  if (line.label === null) {
    return `${conditions} → no answer (rule unsure): ${rows}`;
  }
  return `${conditions} → ${line.label}: ${rows}, ${String(line.agree.k)} agree with the model`;
}

export function lineFilter(line: LeafLine): RowFilter {
  return {
    rowIds: line.row_ids,
    description: `Showing ${String(line.row_ids.length)} rows for rule line ${String(line.line_no)}`,
  };
}

/** Rows whose shown answer differs from their rule line's, mapped to that line's number. */
export function disagreements(
  lines: readonly LeafLine[],
  human: ByRow<string>,
  proposals: ShownProposals,
): ReadonlyMap<number, number> {
  const found = new Map<number, number>();
  for (const line of lines) {
    if (line.label === null) continue;
    for (const rowId of line.row_ids) {
      const shown = rowLabel(rowId, human, proposals);
      if (
        (shown.kind === 'human' || shown.kind === 'proposed') &&
        shown.label !== line.label
      ) {
        found.set(rowId, line.line_no);
      }
    }
  }
  return found;
}
