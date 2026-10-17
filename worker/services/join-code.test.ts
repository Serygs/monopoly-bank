import { describe, expect, it } from 'vitest';
import { generateJoinCode } from './game-service.js';

describe('generateJoinCode', () => {
  it('draws four characters that are easy to read aloud', () => {
    for (let index = 0; index < 500; index += 1)
      expect(generateJoinCode()).toMatch(/^[A-HJKMNP-Z2-9]{4}$/u);
  });

  it('never draws the look-alikes 0, O, 1, I or L', () => {
    const seen = new Set(Array.from({ length: 2000 }, generateJoinCode).join(''));
    for (const symbol of ['0', 'O', '1', 'I', 'L']) expect(seen.has(symbol)).toBe(false);
    // Every one of the 31 remaining symbols is reachable.
    expect(seen.size).toBe(31);
  });

  it('varies between draws', () => {
    expect(new Set(Array.from({ length: 200 }, generateJoinCode)).size).toBeGreaterThan(150);
  });
});
