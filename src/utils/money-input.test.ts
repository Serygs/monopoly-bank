import { describe, expect, it } from 'vitest';
import { appendMoneyDigit, removeMoneyDigit, sanitizeMoneyInput } from './money-input';

describe('money input', () => {
  it('accepts digits without leading-zero garbage', () => {
    expect(appendMoneyDigit('', '0')).toBe('0');
    expect(appendMoneyDigit('0', '5')).toBe('5');
    expect(appendMoneyDigit('100', '0')).toBe('1000');
  });
  it('backspaces and clears safely', () => {
    expect(removeMoneyDigit('1000')).toBe('100');
    expect(removeMoneyDigit('')).toBe('');
    expect(sanitizeMoneyInput('')).toBe('');
  });
  it('normalizes manual input and caps unsafe values', () => {
    expect(sanitizeMoneyInput('001 200x')).toBe('1200');
    expect(sanitizeMoneyInput('99999999999')).toBe('9999999999');
  });
});
