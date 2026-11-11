import { describe, expect, it } from 'vitest';
import { shownSuspects } from '../src/audit';
import type { Suspect } from '../src/backend/types';

const SUSPECTS: readonly Suspect[] = [
  { row_id: 7, given: 'a', given_probability: 0.01, likely: 'b' },
  { row_id: 3, given: 'a', given_probability: 0.05, likely: 'b' },
  { row_id: 9, given: 'b', given_probability: 0.2, likely: 'a' },
];

describe('shown suspects', () => {
  it('ranks by plausibility and reads each row as open, stet or fixed', () => {
    const shown = shownSuspects(
      SUSPECTS,
      { '7': 'a', '3': 'a', '9': 'a' },
      new Set([3]),
    );

    expect(shown.get(7)).toMatchObject({ rank: 0, state: 'open' });
    expect(shown.get(3)).toMatchObject({ rank: 1, state: 'stet' });
    expect(shown.get(9)).toMatchObject({ rank: 2, state: 'fixed' });
  });

  it('has nothing to show before an audit', () => {
    expect(shownSuspects(null, {}, new Set()).size).toBe(0);
  });
});
