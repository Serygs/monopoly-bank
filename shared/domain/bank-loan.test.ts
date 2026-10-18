import { describe, expect, it } from 'vitest';
import { bankLoanInterest, isInterestRatePercent } from './bank-loan.js';

describe('bankLoanInterest', () => {
  const message = 'The principal must be a positive safe integer.';

  it('rounds the half up and everything below the half down', () => {
    expect(bankLoanInterest(5, 10)).toBe(1);
    expect(bankLoanInterest(4, 10)).toBe(0);
    expect(bankLoanInterest(25, 20)).toBe(5);
    expect(bankLoanInterest(2, 20)).toBe(0);
    expect(bankLoanInterest(3, 20)).toBe(1);
  });

  it('charges nothing at a rate of zero for any principal', () => {
    expect(bankLoanInterest(1, 0)).toBe(0);
    expect(bankLoanInterest(Number.MAX_SAFE_INTEGER, 0)).toBe(0);
  });

  it('refuses a zero, negative or fractional principal with the reason', () => {
    expect(() => bankLoanInterest(0, 10)).toThrow(message);
    expect(() => bankLoanInterest(-100, 10)).toThrow(message);
    expect(() => bankLoanInterest(10.5, 10)).toThrow(message);
    expect(() => bankLoanInterest(Number.NaN, 10)).toThrow(message);
    expect(() => bankLoanInterest(Number.POSITIVE_INFINITY, 10)).toThrow(message);
  });

  it('refuses a principal whose product with the rate leaves no room for the rounding step', () => {
    const largestExactProduct = Math.floor((Number.MAX_SAFE_INTEGER - 50) / 10);
    expect(bankLoanInterest(largestExactProduct, 10)).toBe(
      Math.floor((largestExactProduct * 10 + 50) / 100),
    );
    expect(() => bankLoanInterest(largestExactProduct + 1, 10)).toThrow(message);
    expect(() => bankLoanInterest(900_719_925_474_099, 10)).toThrow(message);
  });
});

describe('isInterestRatePercent', () => {
  it('accepts exactly the three offered rates', () => {
    for (const rate of [0, 10, 20]) expect(isInterestRatePercent(rate)).toBe(true);
  });

  it('rejects other numbers, strings and empty values', () => {
    for (const value of [5, 15, 30, -10, '10', null, undefined, Number.NaN])
      expect(isInterestRatePercent(value)).toBe(false);
  });
});
