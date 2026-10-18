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

describe('payment amount helpers reject amounts that are not positive whole numbers', () => {
  const invalid = [0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1];

  it.each(invalid)('leaves recent amounts alone for %s and returns a copy', (amount) => {
    const recent = [50, 20];
    const result = addRecentAmount(recent, amount);
    expect(result).toEqual([50, 20]);
    expect(result).not.toBe(recent);
  });

  it.each(invalid)('leaves favorites alone for %s and returns a copy', (amount) => {
    const favorites = [50, 20];
    const result = toggleFavoriteAmount(favorites, amount);
    expect(result).toEqual([50, 20]);
    expect(result).not.toBe(favorites);
  });

  it('accepts 1 and the largest safe integer', () => {
    expect(addRecentAmount([], 1)).toEqual([1]);
    expect(addRecentAmount([], Number.MAX_SAFE_INTEGER)).toEqual([Number.MAX_SAFE_INTEGER]);
    expect(toggleFavoriteAmount([], 1)).toEqual([1]);
  });

  it('starts from an empty list and never grows past five recent amounts', () => {
    expect(addRecentAmount([], 7)).toEqual([7]);
    expect(addRecentAmount([1, 2, 3, 4, 5], 6)).toEqual([6, 1, 2, 3, 4]);
    expect(addRecentAmount([1, 2, 3, 4], 5)).toEqual([5, 1, 2, 3, 4]);
  });

  it('does not change the lists it is given', () => {
    const recent = [1, 2];
    addRecentAmount(recent, 3);
    expect(recent).toEqual([1, 2]);
    const favorites = [1, 2];
    toggleFavoriteAmount(favorites, 1);
    expect(favorites).toEqual([1, 2]);
  });
});
