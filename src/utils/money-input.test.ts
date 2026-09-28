import { describe, expect, it } from 'vitest';
import {
  AMOUNT_UNIT_FACTOR,
  appendMoneyDigit,
  changeAmountUnit,
  fromCanonicalAmount,
  maxDigitsFor,
  removeMoneyDigit,
  sanitizeMoneyInput,
  syncCanonicalAmount,
  toCanonicalAmount,
  type AmountInputState,
} from './money-input';

describe('money input', () => {
  it('accepts digits without leading-zero garbage', () => {
    expect(appendMoneyDigit('', '0', 'THOUSANDS')).toBe('0');
    expect(appendMoneyDigit('0', '5', 'THOUSANDS')).toBe('5');
    expect(appendMoneyDigit('100', '0', 'THOUSANDS')).toBe('1000');
  });
  it('ignores non-digit input', () => {
    expect(appendMoneyDigit('12', 'x', 'MILLIONS')).toBe('12');
  });
  it('derives the digit limit from the unit factor', () => {
    expect(AMOUNT_UNIT_FACTOR).toEqual({ ONES: 1, THOUSANDS: 1_000, MILLIONS: 1_000_000 });
    expect(maxDigitsFor('ONES')).toBe(9999999999);
    expect(maxDigitsFor('THOUSANDS')).toBe(9999999);
    expect(maxDigitsFor('MILLIONS')).toBe(9999);
  });
  it('refuses digits that exceed the unit limit', () => {
    expect(appendMoneyDigit('9999', '9', 'MILLIONS')).toBe('9999');
    expect(appendMoneyDigit('9999999', '9', 'THOUSANDS')).toBe('9999999');
    expect(appendMoneyDigit('9999999999', '9', 'ONES')).toBe('9999999999');
  });
  it('backspaces and clears safely', () => {
    expect(removeMoneyDigit('1000')).toBe('100');
    expect(removeMoneyDigit('')).toBe('');
    expect(sanitizeMoneyInput('', 'THOUSANDS')).toBe('');
  });
  it('normalizes manual input and caps unsafe values per unit', () => {
    expect(sanitizeMoneyInput('001 200x', 'ONES')).toBe('1200');
    expect(sanitizeMoneyInput('99999999999', 'ONES')).toBe('9999999999');
    expect(sanitizeMoneyInput('99999999', 'THOUSANDS')).toBe('9999999');
    expect(sanitizeMoneyInput('99999', 'MILLIONS')).toBe('9999');
  });
});

describe('amount input state', () => {
  it('multiplies digits into a canonical whole amount', () => {
    expect(toCanonicalAmount({ digits: '', unit: 'MILLIONS' })).toBe('');
    expect(toCanonicalAmount({ digits: '6', unit: 'MILLIONS' })).toBe('6000000');
    expect(toCanonicalAmount({ digits: '6', unit: 'THOUSANDS' })).toBe('6000');
    expect(toCanonicalAmount({ digits: '6', unit: 'ONES' })).toBe('6');
  });
  it('never exceeds the canonical safe limit in millions', () => {
    const canonical = toCanonicalAmount({ digits: '9999', unit: 'MILLIONS' });
    expect(canonical).toBe('9999000000');
    expect(Number(canonical)).toBeLessThanOrEqual(9_999_999_999);
    expect(Number.isSafeInteger(Number(canonical))).toBe(true);
  });
  it('clears digits when the unit changes', () => {
    expect(changeAmountUnit({ digits: '123', unit: 'THOUSANDS' }, 'MILLIONS')).toEqual({
      digits: '',
      unit: 'MILLIONS',
    });
  });
  it('keeps the same state when the unit is unchanged', () => {
    const state: AmountInputState = { digits: '123', unit: 'THOUSANDS' };
    expect(changeAmountUnit(state, 'THOUSANDS')).toBe(state);
  });
  it('returns the same state object when the canonical value already matches', () => {
    const state: AmountInputState = { digits: '5', unit: 'MILLIONS' };
    expect(syncCanonicalAmount(state, '5000000')).toBe(state);
  });
  it('adopts an external canonical value in whole units', () => {
    expect(syncCanonicalAmount({ digits: '5', unit: 'MILLIONS' }, '100')).toEqual({
      digits: '100',
      unit: 'ONES',
    });
  });
  it('keeps the chosen unit when the canonical value is cleared', () => {
    expect(syncCanonicalAmount({ digits: '5', unit: 'MILLIONS' }, '')).toEqual({
      digits: '',
      unit: 'MILLIONS',
    });
  });
  it('keeps the chosen unit for an external value that divides evenly', () => {
    expect(syncCanonicalAmount({ digits: '', unit: 'MILLIONS' }, '2000000')).toEqual({
      digits: '2',
      unit: 'MILLIONS',
    });
  });
  it('expresses a canonical amount in the preferred unit or falls back to whole units', () => {
    expect(fromCanonicalAmount('15000000', 'MILLIONS')).toEqual({ digits: '15', unit: 'MILLIONS' });
    expect(fromCanonicalAmount('250000', 'THOUSANDS')).toEqual({
      digits: '250',
      unit: 'THOUSANDS',
    });
    expect(fromCanonicalAmount('1500', 'MILLIONS')).toEqual({ digits: '1500', unit: 'ONES' });
    expect(fromCanonicalAmount('', 'THOUSANDS')).toEqual({ digits: '', unit: 'THOUSANDS' });
  });
});
