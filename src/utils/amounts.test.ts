import { describe, expect, it } from 'vitest';
import { addRecentAmount, toggleFavoriteAmount } from './amounts';

describe('payment amount helpers', () => {
  it('keeps five unique recent amounts and moves reused values first', () => {
    expect(addRecentAmount([50, 120, 200, 75, 100], 120)).toEqual([120, 50, 200, 75, 100]);
    expect(addRecentAmount([50, 120, 200, 75, 100], 10)).toEqual([10, 50, 120, 200, 75]);
  });
  it('adds and removes a unique favorite', () => {
    expect(toggleFavoriteAmount([50], 75)).toEqual([75, 50]);
    expect(toggleFavoriteAmount([75, 50], 75)).toEqual([50]);
  });
});
