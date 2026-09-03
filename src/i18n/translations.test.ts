import { describe, expect, it } from 'vitest';
import { languageLocale, translate } from './translations';

describe('UI translations', () => {
  it('provides English and Ukrainian copy', () => {
    expect(translate('en', 'savedGames')).toBe('Saved games');
    expect(translate('uk', 'savedGames')).toBe('Збережені ігри');
  });

  it('interpolates values without changing user-provided text', () => {
    expect(translate('uk', 'gameRemoved', { name: 'Friday Game' })).toBe('Гру Friday Game видалено.');
  });

  it('uses locale-specific format identifiers', () => {
    expect(languageLocale('en')).toBe('en-US');
    expect(languageLocale('uk')).toBe('uk-UA');
  });
});
