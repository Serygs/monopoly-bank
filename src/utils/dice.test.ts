import { describe, expect, it } from 'vitest';
import { rollDice, rollDie } from './dice';

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
