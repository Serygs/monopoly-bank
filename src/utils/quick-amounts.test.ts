import { describe, expect, it } from 'vitest';
import { mergeQuickAmounts } from './quick-amounts';

describe('mergeQuickAmounts', () => {
  it('orders favourites, recent and standard amounts', () => {
    expect(mergeQuickAmounts([500], [20, 50], [100, 200])).toEqual([500, 20, 50, 100, 200]);
  });

  it('keeps the first occurrence of a repeated amount', () => {
    expect(mergeQuickAmounts([100, 500], [500, 20], [100, 200, 20])).toEqual([100, 500, 20, 200]);
  });

  it('drops zero and negative amounts', () => {
    expect(mergeQuickAmounts([0, -5], [], [100])).toEqual([100]);
  });

  it('returns an empty list when nothing is given', () => {
    expect(mergeQuickAmounts([], [], [])).toEqual([]);
  });
});
