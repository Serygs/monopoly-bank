import { describe, expect, it } from 'vitest';
import { defaultGameRules } from '../types/monopoly.js';
import {
  buildGameSettings,
  deriveMoneyUnit,
  isGameRuleEnabled,
  normalizeGameRules,
} from './game-rules.js';

describe('deriveMoneyUnit', () => {
  it.each([
    [15_000_000, 100_000],
    [1_500_000, 10_000],
    [3_000_000, 20_000],
    [7_500_000, 50_000],
    [1_500, 10],
    [1, 10],
    [100, 10],
  ])('starting balance %i gives a unit of %i', (startingBalance, unit) => {
    expect(deriveMoneyUnit(startingBalance)).toBe(unit);
  });

  it('rounds to the nearest 1-2-5 value', () => {
    expect(deriveMoneyUnit(1_000_000)).toBe(5_000);
    expect(deriveMoneyUnit(2_000_000)).toBe(10_000);
    expect(deriveMoneyUnit(5_000_000)).toBe(20_000);
  });

  it('rejects balances that are not positive safe integers', () => {
    expect(() => deriveMoneyUnit(0)).toThrow(RangeError);
    expect(() => deriveMoneyUnit(1.5)).toThrow(RangeError);
    expect(() => deriveMoneyUnit(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });
});

describe('deriveMoneyUnit boundaries', () => {
  it('picks the lower unit when the ratio is exactly halfway between two values', () => {
    expect(deriveMoneyUnit(2_250)).toBe(10);
    expect(deriveMoneyUnit(5_250)).toBe(20);
    expect(deriveMoneyUnit(11_250)).toBe(50);
    expect(deriveMoneyUnit(22_500)).toBe(100);
  });

  it('reaches the largest unit of the series and stops there', () => {
    expect(deriveMoneyUnit(150 * 10 ** 12)).toBe(10 ** 12);
    expect(deriveMoneyUnit(150 * 5 * 10 ** 12)).toBe(5 * 10 ** 12);
    expect(deriveMoneyUnit(Number.MAX_SAFE_INTEGER)).toBe(5 * 10 ** 12);
  });

  it('never goes below the minimum unit', () => {
    expect(deriveMoneyUnit(1)).toBe(10);
    expect(deriveMoneyUnit(749)).toBe(10);
    expect(deriveMoneyUnit(1_000)).toBe(10);
  });

  it('refuses an invalid starting balance with the reason', () => {
    const message = 'The starting balance must be a positive safe integer.';
    for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() => deriveMoneyUnit(value)).toThrow(message);
  });
});

describe('buildGameSettings', () => {
  it('derives the amounts from the unit', () => {
    expect(buildGameSettings(15_000_000)).toEqual({
      unit: 100_000,
      incomeTax: 2_000_000,
      luxuryTax: 1_000_000,
      jailFine: 500_000,
      bankLoanMax: 2_000_000,
      auctionMinBid: 100_000,
      auctionBidSteps: [100_000, 250_000, 500_000, 1_000_000],
    });
  });

  it('keeps every amount a whole number, including the half step at the minimum unit', () => {
    const settings = buildGameSettings(1_500);
    expect(settings.unit).toBe(10);
    for (const amount of [
      settings.incomeTax,
      settings.luxuryTax,
      settings.jailFine,
      settings.bankLoanMax,
      settings.auctionMinBid,
      ...settings.auctionBidSteps,
    ])
      expect(Number.isInteger(amount)).toBe(true);
    expect(settings.auctionBidSteps).toEqual([10, 25, 50, 100]);
  });
});

describe('game rules', () => {
  it('turns missing rules off and ignores unknown keys', () => {
    expect(normalizeGameRules(null)).toEqual(defaultGameRules);
    expect(normalizeGameRules({ playerLoans: true, nonsense: true, auctions: 'yes' })).toEqual({
      ...defaultGameRules,
      playerLoans: true,
    });
  });

  it('reports whether a rule is enabled', () => {
    const rules = { ...defaultGameRules, auctions: true };
    expect(isGameRuleEnabled({ rules }, 'auctions')).toBe(true);
    expect(isGameRuleEnabled({ rules }, 'bankLoans')).toBe(false);
  });
});
