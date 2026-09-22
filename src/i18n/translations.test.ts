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

  it('localizes the amount unit toggle in both languages', () => {
    const keys = ['amountUnitGroup', 'amountUnitThousandsShort', 'amountUnitMillionsShort', 'amountUnitThousands', 'amountUnitMillions', 'inThousands', 'inMillions', 'amountTotalHint'] as const;
    for (const key of keys) {
      expect(translate('en', key).trim()).not.toBe('');
      expect(translate('uk', key).trim()).not.toBe('');
    }
    expect(translate('en', 'amountUnitThousandsShort')).toBe('K');
    expect(translate('en', 'amountUnitMillionsShort')).toBe('M');
    expect(translate('uk', 'amountUnitThousandsShort')).toBe('Т.');
    expect(translate('uk', 'amountUnitMillionsShort')).toBe('М.');
    expect(translate('uk', 'amountTotalHint', { amount: '$5 000' })).toBe('Сума: $5 000');
  });

  it('uses locale-specific format identifiers', () => {
    expect(languageLocale('en')).toBe('en-US');
    expect(languageLocale('uk')).toBe('uk-UA');
  });
});
