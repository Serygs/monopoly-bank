import { describe, expect, it } from 'vitest';
import { getGameNameSuggestions, randomSuggestionStart } from './game-name-suggestions';

describe('game name suggestions', () => {
  it('returns six distinct localized suggestions', () => {
    const english = getGameNameSuggestions('en', 0);
    const ukrainian = getGameNameSuggestions('uk', 0);

    expect(english).toHaveLength(6);
    expect(new Set(english.map(({ name }) => name))).toHaveLength(6);
    expect(english[0]?.name).toBe('Classic Monopoly');
    expect(ukrainian[0]?.name).toBe('Класична Монополія');
  });

  it('wraps through the pool without duplicates', () => {
    const suggestions = getGameNameSuggestions('en', 10);
    expect(new Set(suggestions.map(({ name }) => name))).toHaveLength(6);
  });

  it('supports deterministic random selection in tests', () => {
    expect(randomSuggestionStart(() => 0)).toBe(0);
    expect(randomSuggestionStart(() => 0.5)).toBe(6);
  });
});
