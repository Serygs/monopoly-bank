import { describe, expect, it } from 'vitest';
import { applyDiceResult, rollDice, rollDie } from './dice';

describe('dice utilities', () => {
  it('produces die values from 1 through 6', () => {
    expect(rollDie(() => 0)).toBe(1);
    expect(rollDie(() => 0.999999)).toBe(6);
  });

  it('produces totals from 2 through 12', () => {
    expect(rollDice(() => 0)).toMatchObject({ first: 1, second: 1, total: 2 });
    expect(rollDice(() => 0.999999)).toMatchObject({ first: 6, second: 6, total: 12 });
  });

  it('identifies doubles', () => {
    expect(rollDice(() => 0.4).isDouble).toBe(true);
    const values = [0, 0.5];
    expect(rollDice(() => values.shift() ?? 0).isDouble).toBe(false);
  });
});

describe('consecutive doubles', () => {
  it('increments doubles and sends only the third double to jail', () => {
    const double = { first: 4, second: 4, total: 8, isDouble: true };
    expect(applyDiceResult(0, double)).toMatchObject({ consecutiveDoubles: 1, thirdDouble: false });
    expect(applyDiceResult(1, double)).toMatchObject({ consecutiveDoubles: 2, thirdDouble: false });
    expect(applyDiceResult(2, double)).toEqual({ consecutiveDoubles: 0, isInJail: true, thirdDouble: true });
  });

  it('resets a player counter on a non-double', () => {
    expect(applyDiceResult(2, { first: 1, second: 2, total: 3, isDouble: false })).toEqual({ consecutiveDoubles: 0, isInJail: false, thirdDouble: false });
  });
});
