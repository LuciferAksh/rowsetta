import type { Distilled, LeafLine } from './backend/types';

/** Depths the rule can be fitted at; deeper trees stop reading as a few plain lines. */
export const RULE_DEPTHS = [2, 3, 4, 5, 6] as const;
export const DEFAULT_RULE_DEPTH = 4;

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

/** Each row where the rule and the model answer differently, mapped to its line number. */
export function disagreementLines(
  rule: Distilled | null,
): ReadonlyMap<number, number> {
  const found = new Map<number, number>();
  if (rule === null) return found;
  const rows = new Set(rule.disagreements);
  for (const line of rule.leaf_summary) {
    for (const rowId of line.row_ids) {
      if (rows.has(rowId)) found.set(rowId, line.line_no);
    }
  }
  return found;
}
