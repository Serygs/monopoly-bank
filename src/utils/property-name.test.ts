import { describe, expect, it } from 'vitest';
import type { BoardSnapshot } from '../../shared/board';
import { buildGameSettings } from '../../shared/domain/game-rules';
import type { TranslationKey } from '../i18n/translations';
import { tileDisplayName, tileDisplayNames } from './property-name';

const board = buildGameSettings(15_000_000, 'monopoly-ru-2012').board as BoardSnapshot;
const t = (key: TranslationKey) => `<${key}>`;

describe('tileDisplayName', () => {
  it('shows the name of a tile on the board', () => {
    expect(tileDisplayName(board, 'zhitna', t)).toBe('Житна вул.');
  });

  it('falls back to the translated unknown label for a tile that is not on the board', () => {
    expect(tileDisplayName(board, 'nowhere', t)).toBe('<propertyUnknown>');
  });

  it('falls back to the unknown label when the game has no board', () => {
    expect(tileDisplayName(null, 'zhitna', t)).toBe('<propertyUnknown>');
    expect(tileDisplayName(undefined, 'zhitna', t)).toBe('<propertyUnknown>');
  });
});

describe('tileDisplayNames', () => {
  it('joins the names with a comma and a space, keeping the order given', () => {
    expect(tileDisplayNames(board, ['nagatinska', 'zhitna'], t)).toBe(
      'Нагатинська вул., Житна вул.',
    );
  });

  it('names an unknown tile in place and gives an empty string for no tiles', () => {
    expect(tileDisplayNames(board, ['zhitna', 'nowhere'], t)).toBe('Житна вул., <propertyUnknown>');
    expect(tileDisplayNames(board, [], t)).toBe('');
  });
});
