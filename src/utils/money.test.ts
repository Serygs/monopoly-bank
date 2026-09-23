import { describe, expect, it } from 'vitest';
import { formatMoney, formatMoneyDelta, formatThousands } from './money';

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
    expect(formatMoneyDelta(-1000, 'USD')).toBe('-$1 000');
    expect(formatMoneyDelta(1000, 'UAH')).toBe('+₴1 000');
  });
});
