import { describe, expect, it } from 'vitest';

import { translate } from '../i18n/translations.js';
import { gameStatusTranslationKey } from './game-status.js';

describe('game status labels', () => {
  it.each([
    ['LOBBY', 'Лобі'],
    ['ACTIVE', 'Активна'],
    ['FINISHED', 'Завершена'],
  ] as const)('renders %s using its actual persisted state', (status, expected) => {
    expect(translate('uk', gameStatusTranslationKey(status))).toBe(expected);
  });
});
