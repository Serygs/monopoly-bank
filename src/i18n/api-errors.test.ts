import { describe, expect, it } from 'vitest';

import { MonopolyBankApiError } from '../api/monopoly-bank-api.js';
import { apiErrorMessage, apiErrorTranslationKey } from './api-errors.js';
import { translate } from './translations.js';

const domainSources = import.meta.glob<string>('../../shared/domain/*.ts', { query: '?raw', import: 'default', eager: true });
const domainErrorCodes = [...new Set(Object.entries(domainSources)
  .filter(([file]) => !file.endsWith('.test.ts'))
  .flatMap(([, source]) => [...source.matchAll(/readonly code = '([A-Z_]+)' as const/g)].map((match) => match[1])))];

/** Codes the Worker raises around the domain: lookups, conflicts and board ownership. */
const workerErrorCodes = ['TRADE_NOT_FOUND', 'TRADE_NOT_PENDING', 'BOARD_IN_USE', 'BOARD_NOT_FOUND', 'BOARD_REQUIRED', 'BOARD_LIMIT_REACHED'];

describe('API error messages', () => {
  it.each([
    ['ACCOUNT_IDENTIFIER_UNAVAILABLE', 'Цей псевдонім вже зайнятий. Оберіть інший.'],
    ['INVALID_JOIN_CODE', 'Код запрошення або пароль столу неправильний, прострочений чи відкликаний.'],
    ['LOBBY_CLOSED', 'Це лобі закрите, гра вже почалася або всі місця зайняті.'],
    ['RATE_LIMITED', 'Забагато спроб. Зачекайте та спробуйте ще раз.'],
    ['PROPERTY_ALREADY_OWNED', 'Це поле вже має власника.'],
    ['MORTGAGE_RESOLUTION_REQUIRED', 'Оберіть, що робити із заставленим полем.'],
  ])('explains %s instead of showing a generic join error', (code, expected) => {
    const error = new MonopolyBankApiError({ code, message: 'Server message' });

    expect(apiErrorMessage(error, (key, values) => translate('uk', key, values), 'unableJoinGame')).toBe(expected);
  });

  it('keeps the operation-specific fallback for an unknown error code', () => {
    const error = new MonopolyBankApiError({ code: 'UNKNOWN_CODE', message: 'Server message' });

    expect(apiErrorMessage(error, (key, values) => translate('en', key, values), 'unableJoinGame')).toBe('Unable to join this game.');
  });

  it('collects the domain error codes from shared/domain', () => {
    expect(domainErrorCodes).toEqual(expect.arrayContaining(['PROPERTY_NOT_FOUND', 'TRADE_EMPTY', 'PLAYER_NOT_IN_JAIL', 'INCOMPLETE_ESTATE', 'BUILDINGS_PRESENT']));
    expect(domainErrorCodes.length).toBeGreaterThanOrEqual(20);
  });

  it.each([...domainErrorCodes, ...workerErrorCodes])('gives %s copy in English and Ukrainian', (code) => {
    const key = apiErrorTranslationKey(code);
    expect(key).not.toBeNull();
    if (key === null) return;
    const english = translate('en', key);
    const ukrainian = translate('uk', key);
    expect(english.trim()).not.toBe('');
    expect(ukrainian.trim()).not.toBe('');
    expect(ukrainian).not.toBe(english);
  });
});
