import { describe, expect, it } from 'vitest';
import {
  MAX_PROPERTY_NAME_LENGTH,
  normalizePropertyName,
  propertyNameKey,
  redemptionCost,
} from './mortgage.js';

describe('redemptionCost', () => {
  it.each([
    [1_200_000, 1_320_000],
    [100_000, 110_000],
    [100, 110],
    [15, 17],
    [14, 15],
    [5, 6],
    [4, 4],
    [1, 1],
  ])('mortgage value %i costs %i to redeem', (value, cost) => {
    expect(redemptionCost(value)).toBe(cost);
  });

  it('stays a whole number for large values', () => {
    expect(Number.isInteger(redemptionCost(9_999_999_999))).toBe(true);
    expect(redemptionCost(9_999_999_999)).toBe(10_999_999_999);
  });
});

describe('normalizePropertyName', () => {
  it('trims and collapses inner whitespace', () => {
    expect(normalizePropertyName('  Park   Place ')).toBe('Park Place');
  });

  it('accepts letters of any script', () => {
    expect(normalizePropertyName('Вулиця Хрещатик')).toBe('Вулиця Хрещатик');
  });

  it('rejects an empty, too long or control-character name', () => {
    expect(normalizePropertyName('   ')).toBeNull();
    expect(normalizePropertyName('x'.repeat(MAX_PROPERTY_NAME_LENGTH + 1))).toBeNull();
    expect(normalizePropertyName('x'.repeat(MAX_PROPERTY_NAME_LENGTH))).not.toBeNull();
    expect(normalizePropertyName('Bad\u0007Name')).toBeNull();
  });
});

describe('redemptionCost near the safe-integer limit', () => {
  it('stays exact where value * 11 would no longer be', () => {
    const value = 8_000_000_000_000_000; // 8e15: value * 11 is beyond 2^53, value * 1.1 is not
    expect(redemptionCost(value)).toBe(8_800_000_000_000_000);
    expect(Number.isSafeInteger(redemptionCost(value))).toBe(true);
  });
});

describe('property names beyond ASCII', () => {
  it('stores one canonical form for composed and decomposed letters', () => {
    const composed = '\u0419орк'; // Й as one character
    const decomposed = '\u0418\u0306орк'; // И plus a combining breve
    expect(composed).not.toBe(decomposed);
    expect(normalizePropertyName(decomposed)).toBe(composed);
    expect(propertyNameKey(decomposed)).toBe(propertyNameKey(composed));
  });

  it('compares names ignoring case in any script', () => {
    expect(propertyNameKey('Київ')).toBe(propertyNameKey('КИЇВ'));
    expect(propertyNameKey('Park Place')).toBe(propertyNameKey('PARK place'));
    expect(propertyNameKey('Park Place')).not.toBe(propertyNameKey('Park Lane'));
  });

  it.each([
    ['a zero-width space', 'Board\u200Bwalk'],
    ['a right-to-left override', 'Board\u202Ewalk'],
    ['a C1 control', 'Board\u0085walk'],
  ])('rejects %s', (_label, name) => {
    expect(normalizePropertyName(name)).toBeNull();
  });

  it('treats a byte-order mark or line separator as plain whitespace', () => {
    expect(normalizePropertyName('\uFEFFBoardwalk')).toBe('Boardwalk');
    expect(normalizePropertyName('Board\u2028walk')).toBe('Board walk');
  });
});
