import { describe, expect, it } from 'vitest';
import {
  decimalSeparator,
  formatMoney,
  formatMoneyDelta,
  formatThousands,
  moneyTone,
} from './money';

describe('money formatting', () => {
  it.each([
    ['USD', '$1 000'],
    ['EUR', '€1 000'],
    ['UAH', '₴1 000'],
    ['K', '1 000k'],
  ] as const)('formats %s currency', (currency, expected) => {
    expect(formatMoney(1000, currency)).toBe(expected);
  });
  it('always groups displayed amounts with spaces', () => {
    expect(formatThousands(1000)).toBe('1 000');
    expect(formatThousands(10000)).toBe('10 000');
    expect(formatThousands(1000000)).toBe('1 000 000');
    expect(formatMoney(0, 'K')).toBe('0k');
  });
  it('formats negative deltas without losing the currency', () => {
    expect(formatMoneyDelta(-1000, 'USD')).toBe('\u2212$1 000');
    expect(formatMoneyDelta(1000, 'UAH')).toBe('+₴1 000');
  });
  it('classifies a change as income, expense or neutral', () => {
    expect(moneyTone(5)).toBe('income');
    expect(moneyTone(-5)).toBe('expense');
    expect(moneyTone(0)).toBe('neutral');
  });
});

describe('money formatting edge cases', () => {
  it('groups every three digits from the right, however long the amount', () => {
    expect(formatThousands(0)).toBe('0');
    expect(formatThousands(7)).toBe('7');
    expect(formatThousands(999)).toBe('999');
    expect(formatThousands(1_234)).toBe('1 234');
    expect(formatThousands(12_345)).toBe('12 345');
    expect(formatThousands(123_456)).toBe('123 456');
    expect(formatThousands(1_234_567)).toBe('1 234 567');
    expect(formatThousands(Number.MAX_SAFE_INTEGER)).toBe('9 007 199 254 740 991');
  });

  it('groups the size of a number, not its sign', () => {
    expect(formatThousands(-1_234)).toBe('1 234');
    expect(formatThousands(-999)).toBe('999');
  });

  it('keeps the minus sign of a negative amount, in front of the number', () => {
    expect(formatMoney(-1_500, 'K')).toBe('-1 500k');
    expect(formatMoney(-1, 'UAH')).toBe('₴-1');
    expect(formatMoney(-1_000, 'USD')).toBe('$-1 000');
    expect(formatMoney(-1_000, 'EUR')).toBe('€-1 000');
  });

  it('shows zero and negative zero without a sign', () => {
    expect(formatMoney(0, 'USD')).toBe('$0');
    expect(formatMoney(-0, 'USD')).toBe('$0');
  });

  it('writes a number too large for grouping in exponent form instead of failing', () => {
    expect(formatMoney(1e21, 'USD')).toBe('$1e+21');
  });

  it('treats zero as a gain in a delta, with a plus sign, and a loss with a true minus sign', () => {
    expect(formatMoneyDelta(0, 'USD')).toBe('+$0');
    expect(formatMoneyDelta(-0, 'USD')).toBe('+$0');
    expect(formatMoneyDelta(1, 'K')).toBe('+1k');
    expect(formatMoneyDelta(-1, 'K')).toBe('−1k');
  });

  it('classifies the smallest changes either side of zero', () => {
    expect(moneyTone(1)).toBe('income');
    expect(moneyTone(-1)).toBe('expense');
    expect(moneyTone(-0)).toBe('neutral');
  });

  it('knows the decimal separator of each locale', () => {
    expect(decimalSeparator('en-US')).toBe('.');
    expect(decimalSeparator('uk-UA')).toBe(',');
  });
});
