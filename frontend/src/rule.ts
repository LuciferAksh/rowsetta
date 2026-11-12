import type { Cell, Condition, Distilled, LeafLine } from './backend/types';

/** Depths the rule can be fitted at; deeper trees stop reading as a few plain lines. */
export const RULE_DEPTHS = [2, 3, 4, 5, 6] as const;
export const DEFAULT_RULE_DEPTH = 4;

/** Rows the table narrows to, and the words that say why. */
export interface RowFilter {
  rowIds: readonly number[];
  description: string;
}

/** The shortest decimal text that reads back as the same 32-bit float. */
function shortestFloat32(value: number): string {
  for (let digits = 1; digits <= 9; digits++) {
    const candidate = Number(value.toPrecision(digits));
    if (Math.fround(candidate) === Math.fround(value)) return String(candidate);
  }
  return String(value);
}

function decimalPlaces(text: string): number {
  return text.split('.')[1]?.length ?? 0;
}

/**
 * Decimal places each column is written with, read off the rows on screen, so
 * a threshold can be shown in the precision of the values it splits.
 */
export function columnDecimals(
  rows: readonly Readonly<Record<string, Cell>>[],
): ReadonlyMap<string, number> {
  const places = new Map<string, number>();
  for (const row of rows) {
    for (const [column, cell] of Object.entries(row)) {
      if (typeof cell !== 'number') continue;
      places.set(
        column,
        Math.max(places.get(column) ?? 0, decimalPlaces(String(cell))),
      );
    }
  }
  return places;
}

/**
 * A split value for people: the model stores thresholds as 32-bit floats, so
 * show the shortest text that round-trips, and no more than one place beyond the
 * column's own (a threshold sits halfway between two recorded values).
 */
export function formatThreshold(
  value: string,
  decimals: number | undefined,
): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  const shortest = shortestFloat32(number);
  if (decimals === undefined || decimalPlaces(shortest) <= decimals + 1) {
    return shortest;
  }
  return String(Number(number.toFixed(decimals + 1)));
}

const UNIT_SUFFIX = /_(?:mm|cm|kg|g|m|s|ms)$/;
const MISSING_PREFIX = /^IS (?:NOT )?NULL (?:OR|AND) /;

interface Bound {
  value: number;
  strict: boolean;
}

/**
 * A rule line's tests as one short phrase per column: the numeric bounds on a
 * column merge into an interval, `flipper length ≤ 206.5 · 40.75 < bill length ≤ 42.35`.
 * Which side missing values take is left to the exported SQL.
 */
export function ruleIntervals(
  conditions: readonly Condition[],
  decimals: ReadonlyMap<string, number> = new Map(),
): string {
  const phrases = new Map<
    string,
    { lower?: Bound; upper?: Bound; words: string[] }
  >();
  for (const [column, operator, value] of conditions) {
    const entry = phrases.get(column) ?? { words: [] };
    phrases.set(column, entry);
    const test = operator.replace(MISSING_PREFIX, '');
    const number = Number(value);
    if (Number.isFinite(number)) {
      const upper = test === '<=' || test === '<';
      const bound = { value: number, strict: test === '<' || test === '>' };
      if (upper && (entry.upper === undefined || number < entry.upper.value)) {
        entry.upper = bound;
      } else if (
        !upper &&
        (entry.lower === undefined || number > entry.lower.value)
      ) {
        entry.lower = bound;
      }
    } else {
      const word = value.replace(/^'|'$/g, '').replace(/''/g, "'");
      entry.words.push(test === '<>' ? `is not ${word}` : `is ${word}`);
    }
  }
  return [...phrases]
    .map(([column, { lower, upper, words }]) => {
      const name = column.replace(UNIT_SUFFIX, '').replaceAll('_', ' ');
      const shown = (bound: Bound): string =>
        formatThreshold(String(bound.value), decimals.get(column));
      const parts = words.map((word) => `${name} ${word}`);
      if (lower !== undefined && upper !== undefined) {
        parts.push(
          `${shown(lower)} ${lower.strict ? '<' : '≤'} ${name} ${upper.strict ? '<' : '≤'} ${shown(upper)}`,
        );
      } else if (upper !== undefined) {
        parts.push(`${name} ${upper.strict ? '<' : '≤'} ${shown(upper)}`);
      } else if (lower !== undefined) {
        parts.push(`${name} ${lower.strict ? '>' : '≥'} ${shown(lower)}`);
      }
      return parts.join(' · ');
    })
    .join(' · ');
}

/** A rule line split into the pieces its text is made of. */
export function ruleLineParts(
  line: LeafLine,
  decimals: ReadonlyMap<string, number> = new Map(),
): {
  conditions: string;
  answer: string | null;
  rows: string;
  agreeing: string;
} {
  return {
    conditions:
      line.conditions.length === 0
        ? 'every row'
        : ruleIntervals(line.conditions, decimals),
    answer: line.label,
    rows: `${String(line.row_ids.length)} rows`,
    agreeing: `${String(line.agree.k)} agree with the model`,
  };
}

/** The line as plain text for the accessible name and plain-text copies. */
export function ruleLineText(line: LeafLine): string {
  const { conditions, answer, rows, agreeing } = ruleLineParts(line);
  if (answer === null)
    return `${conditions} → no answer (rule unsure): ${rows}`;
  return `${conditions} → ${answer}: ${rows}, ${agreeing}`;
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
