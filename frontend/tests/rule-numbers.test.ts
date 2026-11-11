import { describe, expect, it } from 'vitest';
import type { LeafLine } from '../src/backend/types';
import {
  columnDecimals,
  formatThreshold,
  ruleIntervals,
  ruleLineParts,
} from '../src/rule';

describe('threshold formatting', () => {
  it('drops the digits a 32-bit float adds when written as a double', () => {
    expect(formatThreshold('206.50000762939453', undefined)).toBe('206.5');
    expect(formatThreshold('43.35000038146973', undefined)).toBe('43.35');
  });

  it('keeps no more than one place beyond the column', () => {
    expect(formatThreshold('206.50000762939453', 0)).toBe('206.5');
    expect(formatThreshold('3225.0001220703125', 0)).toBe('3225');
    expect(formatThreshold('42.35000038146973', 1)).toBe('42.35');
  });

  it('leaves text and whole numbers alone', () => {
    expect(formatThreshold("'success'", 1)).toBe("'success'");
    expect(formatThreshold('524', 0)).toBe('524');
  });

  it('reads a column precision off its numeric cells only', () => {
    const places = columnDecimals([
      { bill: 39.1, flipper: 181, island: 'Dream' },
      { bill: 40, flipper: 186.5, island: 'Biscoe' },
    ]);
    expect(places.get('bill')).toBe(1);
    expect(places.get('flipper')).toBe(1);
    expect(places.has('island')).toBe(false);
  });

  it('shows a rule line in the precision of its columns', () => {
    const line: LeafLine = {
      line_no: 1,
      conditions: [
        ['flipper_length_mm', 'IS NULL OR <=', '206.50000762939453'],
        ['island', '=', "'Dream'"],
      ],
      label: 'Adelie',
      row_ids: [0],
      agree: { k: 1, n: 1, coverage: { answered: 1, total: 1 } },
    };
    expect(
      ruleLineParts(line, new Map([['flipper_length_mm', 0]])).conditions,
    ).toBe('flipper_length ≤ 206.5 · island is Dream');
  });

  it('merges bounds on one column into an interval', () => {
    expect(
      ruleIntervals(
        [
          ['bill_length_mm', 'IS NULL OR <=', '43.35000038146973'],
          ['bill_length_mm', 'IS NOT NULL AND >', '40.75000190734863'],
          ['bill_length_mm', 'IS NULL OR <=', '42.35000038146973'],
          ['island', 'IS NULL OR <>', "'Dream'"],
        ],
        new Map([['bill_length_mm', 1]]),
      ),
    ).toBe('40.75 < bill_length ≤ 42.35 · island is not Dream');
  });
});
