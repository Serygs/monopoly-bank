import { describe, expect, it } from 'vitest';
import {
  formatJoinCode,
  isJoinCodeShaped,
  joinCodeFromSearch,
  joinInviteLink,
  normalizeJoinCode,
} from './join-code';

describe('join code helpers', () => {
  it('normalises, formats and links one code the same way everywhere', () => {
    expect(normalizeJoinCode(' ab c-12 ')).toBe('ABC-12');
    expect(formatJoinCode('abcdef')).toBe('ABC DEF');
    expect(formatJoinCode('ABCDEFG')).toBe('ABC DEF G');
    expect(joinInviteLink('https://bank.test', 'abc123')).toBe(
      'https://bank.test/games/join?code=ABC123',
    );
    expect(joinCodeFromSearch('?code=abc123')).toBe('ABC123');
    expect(joinCodeFromSearch('')).toBe('');
  });

  it('checks the length the manual form allows', () => {
    expect(isJoinCodeShaped('abc')).toBe(false);
    expect(isJoinCodeShaped('abcd')).toBe(true);
    expect(isJoinCodeShaped('a'.repeat(13))).toBe(false);
  });
});
