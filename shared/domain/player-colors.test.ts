import { describe, expect, it } from 'vitest';

import {
  findDuplicateColor,
  normalizeColor,
  PLAYER_COLORS,
  pickRandomUnusedColor,
} from './player-colors.js';

describe('pickRandomUnusedColor', () => {
  it('never repeats a colour until the palette is used up', () => {
    for (const random of [() => 0, () => 0.5, () => 0.999]) {
      const taken: string[] = [];
      for (let index = 0; index < PLAYER_COLORS.length; index += 1)
        taken.push(pickRandomUnusedColor(taken, random));
      expect(new Set(taken).size).toBe(PLAYER_COLORS.length);
    }
  });

  it('picks among the free colours using the random value', () => {
    const taken = [PLAYER_COLORS[0], PLAYER_COLORS[1]];
    expect(pickRandomUnusedColor(taken, () => 0)).toBe(PLAYER_COLORS[2]);
    expect(pickRandomUnusedColor(taken, () => 0.999)).toBe(PLAYER_COLORS[5]);
  });

  it('counts a legacy colour as the palette colour it stands for', () => {
    const taken = ['#e05263', PLAYER_COLORS[1]];
    expect(pickRandomUnusedColor(taken, () => 0)).toBe(PLAYER_COLORS[2]);
  });

  it('falls back to the least used colour when every one is taken', () => {
    const taken = [...PLAYER_COLORS, ...PLAYER_COLORS.slice(1)];
    expect(pickRandomUnusedColor(taken, () => 0)).toBe(PLAYER_COLORS[0]);
  });
});

describe('findDuplicateColor', () => {
  it('finds a repeat regardless of case and legacy spelling', () => {
    expect(findDuplicateColor(['#D83F55', '#2878d0'])).toBeNull();
    expect(findDuplicateColor(['#d83f55', '#2878d0', '#D83F55'])).toBe('#D83F55');
    expect(findDuplicateColor(['#d83f55', '#e05263'])).toBe('#e05263');
  });

  it('normalizes case and whitespace', () => {
    expect(normalizeColor(' #2F80ED ')).toBe(PLAYER_COLORS[1]);
  });
});
