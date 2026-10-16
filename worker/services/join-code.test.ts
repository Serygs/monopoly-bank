import { describe, expect, it } from 'vitest';
import { generateJoinCode } from './game-service.js';

describe('generateJoinCode', () => {
  it('draws four characters that are easy to read aloud', () => {
    for (let index = 0; index < 500; index += 1)
      expect(generateJoinCode()).toMatch(/^[A-HJ-NP-Z2-9]{4}$/u);
  });

  it('varies between draws', () => {
    expect(new Set(Array.from({ length: 200 }, generateJoinCode)).size).toBeGreaterThan(150);
  });
});
