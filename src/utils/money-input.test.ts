import { describe, expect, it } from 'vitest';
import {
  AMOUNT_UNIT_FACTOR,
  appendDecimalSeparator,
  appendMoneyDigit,
  changeAmountUnit,
  formatDigitsDisplay,
  fromCanonicalAmount,
  isUnrepresentableAmount,
  maxDigitsFor,
  maxFractionDigits,
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
  it('changes only the multiplier when the unit changes: 3 → M → K → M', () => {
    const millions: AmountInputState = { digits: '3', unit: 'MILLIONS' };
    expect(toCanonicalAmount(millions)).toBe('3000000');
    const thousands = changeAmountUnit(millions, 'THOUSANDS');
    expect(thousands).toEqual({ digits: '3', unit: 'THOUSANDS' });
    expect(toCanonicalAmount(thousands)).toBe('3000');
    const back = changeAmountUnit(thousands, 'MILLIONS');
    expect(back).toEqual({ digits: '3', unit: 'MILLIONS' });
    expect(toCanonicalAmount(back)).toBe('3000000');
  });
  it('multiplies decimals and whole numbers by the chosen unit', () => {
    expect(toCanonicalAmount({ digits: '1.5', unit: 'MILLIONS' })).toBe('1500000');
    expect(toCanonicalAmount({ digits: '0.5', unit: 'THOUSANDS' })).toBe('500');
    expect(toCanonicalAmount({ digits: '250', unit: 'THOUSANDS' })).toBe('250000');
  });
  it('applies a unit chosen before typing to the digits typed afterwards', () => {
    const chosen = changeAmountUnit({ digits: '', unit: 'ONES' }, 'THOUSANDS');
    expect(chosen).toEqual({ digits: '', unit: 'THOUSANDS' });
    expect(toCanonicalAmount(chosen)).toBe('');
    const typed = { ...chosen, digits: appendMoneyDigit(chosen.digits, '7', chosen.unit) };
    expect(toCanonicalAmount(typed)).toBe('7000');
  });
  it('clears to an empty amount and keeps the unit', () => {
    const cleared: AmountInputState = { digits: removeMoneyDigit('5'), unit: 'MILLIONS' };
    expect(cleared).toEqual({ digits: '', unit: 'MILLIONS' });
    expect(toCanonicalAmount(cleared)).toBe('');
  });
  it('keeps digits that are not an amount in the new unit and restores them when switching back', () => {
    const ones = changeAmountUnit({ digits: '1.5', unit: 'MILLIONS' }, 'ONES');
    expect(ones).toEqual({ digits: '1.5', unit: 'ONES' });
    expect(toCanonicalAmount(ones)).toBe('');
    expect(isUnrepresentableAmount(ones)).toBe(true);
    expect(toCanonicalAmount(changeAmountUnit(ones, 'MILLIONS'))).toBe('1500000');
    const overLimit = changeAmountUnit({ digits: '50000', unit: 'THOUSANDS' }, 'MILLIONS');
    expect(toCanonicalAmount(overLimit)).toBe('');
    expect(isUnrepresentableAmount(overLimit)).toBe(true);
    expect(isUnrepresentableAmount({ digits: '', unit: 'ONES' })).toBe(false);
    expect(isUnrepresentableAmount({ digits: '3', unit: 'MILLIONS' })).toBe(false);
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

describe('decimal amounts', () => {
  it('allows fraction digits only where the amount stays whole', () => {
    expect(maxFractionDigits('ONES')).toBe(0);
    expect(maxFractionDigits('THOUSANDS')).toBe(3);
    expect(maxFractionDigits('MILLIONS')).toBe(6);
  });
  it('starts a fraction once, never for whole units', () => {
    expect(appendDecimalSeparator('', 'MILLIONS')).toBe('0.');
    expect(appendDecimalSeparator('3', 'MILLIONS')).toBe('3.');
    expect(appendDecimalSeparator('3.2', 'MILLIONS')).toBe('3.2');
    expect(appendDecimalSeparator('3', 'ONES')).toBe('3');
  });
  it('types fraction digits up to the unit limit', () => {
    expect(appendMoneyDigit('3.', '2', 'MILLIONS')).toBe('3.2');
    expect(appendMoneyDigit('3.2', '5', 'THOUSANDS')).toBe('3.25');
    expect(appendMoneyDigit('3.123', '4', 'THOUSANDS')).toBe('3.123');
  });
  it('turns decimals into a whole canonical amount', () => {
    expect(toCanonicalAmount({ digits: '3.2', unit: 'MILLIONS' })).toBe('3200000');
    expect(toCanonicalAmount({ digits: '0.085', unit: 'MILLIONS' })).toBe('85000');
    expect(toCanonicalAmount({ digits: '2.5', unit: 'THOUSANDS' })).toBe('2500');
    expect(toCanonicalAmount({ digits: '3.', unit: 'MILLIONS' })).toBe('3000000');
  });
  it('keeps fractions inside the amount limit', () => {
    expect(appendMoneyDigit('9999.', '9', 'MILLIONS')).toBe('9999.9');
    expect(appendMoneyDigit('9999', '9', 'MILLIONS')).toBe('9999');
    expect(sanitizeMoneyInput('99999,5', 'MILLIONS')).toBe('9999');
  });
  it('sanitizes typed text with a comma or a dot', () => {
    expect(sanitizeMoneyInput('3,2', 'MILLIONS')).toBe('3.2');
    expect(sanitizeMoneyInput('3.2', 'MILLIONS')).toBe('3.2');
    expect(sanitizeMoneyInput('3,2,5', 'MILLIONS')).toBe('3.25');
    expect(sanitizeMoneyInput(',5', 'MILLIONS')).toBe('0.5');
    expect(sanitizeMoneyInput('3,2', 'ONES')).toBe('3');
    expect(sanitizeMoneyInput('1 234,5678', 'THOUSANDS')).toBe('1234.567');
  });
  it('formats typed digits with grouping and the locale separator', () => {
    expect(formatDigitsDisplay('', ',')).toBe('');
    expect(formatDigitsDisplay('1234567', ',')).toBe('1 234 567');
    expect(formatDigitsDisplay('3.2', ',')).toBe('3,2');
    expect(formatDigitsDisplay('3.', ',')).toBe('3,');
    expect(formatDigitsDisplay('1234.5', '.')).toBe('1 234.5');
  });
});
