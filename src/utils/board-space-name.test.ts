import { describe, expect, it } from 'vitest';
import { colorGroups } from '../../shared/types/monopoly';
import { isTranslationKey, translate, type Language } from '../i18n/translations';
import { boardSpaceName, colorGroupName } from './board-space-name';
import seed from '../../migrations/0018_board_catalog.sql?raw';

const seededKeys = [...seed.matchAll(/'(boardSpace[A-Za-z]+)'/g)].map((match) => match[1]);
const t = (language: Language) => (key: Parameters<typeof translate>[1], values?: Parameters<typeof translate>[2]) => translate(language, key, values);

describe('board space names', () => {
  it('seeds exactly the 28 catalogue keys', () => {
    expect(new Set(seededKeys).size).toBe(28);
    expect(seededKeys).toHaveLength(28);
  });

  it.each(seededKeys)('translates %s in English and Ukrainian', (key) => {
    expect(isTranslationKey(key)).toBe(true);
    if (!isTranslationKey(key)) return;
    const english = translate('en', key);
    const ukrainian = translate('uk', key);
    expect(english.trim()).not.toBe('');
    expect(ukrainian.trim()).not.toBe('');
    expect(ukrainian).not.toBe(english);
    expect(ukrainian).toMatch(/[А-ЯІЇЄҐа-яіїєґ]/u);
  });

  it('renders a canonical space through its translation key', () => {
    const space = { translationKey: 'boardSpaceBoardwalk', customName: null };
    expect(boardSpaceName(space, t('en'))).toBe('Boardwalk');
    expect(boardSpaceName(space, t('uk'))).toBe('Бордвок');
  });

  it('lets a custom name win over the translation', () => {
    const space = { translationKey: 'boardSpaceBoardwalk', customName: 'Хрещатик' };
    expect(boardSpaceName(space, t('en'))).toBe('Хрещатик');
    expect(boardSpaceName(space, t('uk'))).toBe('Хрещатик');
  });

  it('falls back to the raw key for a space the client has not learnt', () => {
    expect(boardSpaceName({ translationKey: 'boardSpaceFutureStreet', customName: null }, t('en'))).toBe('boardSpaceFutureStreet');
    expect(boardSpaceName({ translationKey: 'boardSpaceFutureStreet', customName: '   ' }, t('en'))).toBe('boardSpaceFutureStreet');
  });

  it('names every colour group in both languages', () => {
    for (const group of colorGroups) {
      expect(colorGroupName(group, t('en')).trim()).not.toBe('');
      expect(colorGroupName(group, t('uk')).trim()).not.toBe('');
    }
  });
});
