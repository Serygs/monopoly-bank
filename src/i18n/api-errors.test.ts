import { describe, expect, it } from 'vitest';

import { MonopolyBankApiError } from '../api/monopoly-bank-api.js';
import { apiErrorMessage } from './api-errors.js';
import { translate } from './translations.js';

describe('API error messages', () => {
  it.each([
    ['ACCOUNT_IDENTIFIER_UNAVAILABLE', 'Цей псевдонім вже зайнятий. Оберіть інший.'],
    [
      'INVALID_JOIN_CODE',
      'Код запрошення або пароль столу неправильний, прострочений чи відкликаний.',
    ],
    ['LOBBY_CLOSED', 'Це лобі закрите, гра вже почалася або всі місця зайняті.'],
    ['RATE_LIMITED', 'Забагато спроб. Зачекайте та спробуйте ще раз.'],
  ])('explains %s instead of showing a generic join error', (code, expected) => {
    const error = new MonopolyBankApiError({ code, message: 'Server message' });

    expect(
      apiErrorMessage(error, (key, values) => translate('uk', key, values), 'unableJoinGame'),
    ).toBe(expected);
  });

  it('keeps the operation-specific fallback for an unknown error code', () => {
    const error = new MonopolyBankApiError({ code: 'UNKNOWN_CODE', message: 'Server message' });

    expect(
      apiErrorMessage(error, (key, values) => translate('en', key, values), 'unableJoinGame'),
    ).toBe('Unable to join this game.');
  });
});
