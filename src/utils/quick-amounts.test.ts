import { describe, expect, it } from 'vitest';
import { mergeQuickAmounts, presetAmounts } from './quick-amounts';

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

describe('presetAmounts', () => {
  it('scales to a 15 million starting balance', () => {
    expect(presetAmounts(15_000_000)).toEqual([
      1_000_000, 1_500_000, 2_000_000, 3_000_000, 5_000_000, 10_000_000,
    ]);
  });

  it('scales to a classic 1 500 starting balance', () => {
    expect(presetAmounts(1_500)).toEqual([100, 150, 200, 300, 500, 1_000]);
  });

  it('uses round units for other balances', () => {
    expect(presetAmounts(2_000_000)).toEqual([
      200_000, 300_000, 400_000, 600_000, 1_000_000, 2_000_000,
    ]);
    expect(presetAmounts(100_000)).toEqual([10_000, 15_000, 20_000, 30_000, 50_000, 100_000]);
  });

  it('keeps every preset a positive integer within the starting balance', () => {
    for (const balance of [10, 15, 99, 1_234, 750_000, 25_000_000]) {
      for (const amount of presetAmounts(balance)) {
        expect(Number.isInteger(amount)).toBe(true);
        expect(amount).toBeGreaterThan(0);
        expect(amount).toBeLessThanOrEqual(balance);
      }
    }
  });

  it('returns nothing for a tiny or invalid balance', () => {
    expect(presetAmounts(0)).toEqual([]);
    expect(presetAmounts(9)).toEqual([]);
    expect(presetAmounts(Number.NaN)).toEqual([]);
  });
});
