import { describe, expect, it } from 'vitest';

import { MonopolyBankApiError } from '../api/monopoly-bank-api.js';
import { apiErrorMessage } from './api-errors.js';
import { translate } from './translations.js';

describe('API error messages', () => {
  it.each(['en', 'uk'] as const)(
    'distinguishes invalid credentials from an expired session in %s',
    (language) => {
      const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
      const invalid = new MonopolyBankApiError({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid credentials',
      });
      expect(apiErrorMessage(invalid, t, 'unableAuthenticate')).toBe(t('errorInvalidCredentials'));
      expect(apiErrorMessage(invalid, t, 'unableAuthenticate')).not.toBe(t('errorSessionExpired'));
    },
  );

  it.each([
    ['ACCOUNT_IDENTIFIER_UNAVAILABLE', 'Цей псевдонім вже зайнятий. Оберіть інший.'],
    [
      'INVALID_JOIN_CODE',
      'Код запрошення або пароль столу неправильний, прострочений чи відкликаний.',
    ],
    ['LOBBY_CLOSED', 'Це лобі закрите або гра вже почалася.'],
    ['LOBBY_FULL', 'Це лобі заповнене (6 гравців).'],
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

describe('API error code table', () => {
  const mapped = [
    ['NETWORK_ERROR', 'errorNetwork'],
    ['API_ERROR', 'errorUnexpected'],
    ['VALIDATION_ERROR', 'errorValidation'],
    ['NOT_FOUND', 'errorNotFound'],
    ['PERSISTENCE_ERROR', 'errorPersistence'],
    ['INTERNAL_ERROR', 'errorUnexpected'],
    ['EMAIL_DELIVERY_UNAVAILABLE', 'errorEmailDelivery'],
    ['ACCOUNT_IDENTIFIER_UNAVAILABLE', 'errorNicknameTaken'],
    ['INVALID_JOIN_CODE', 'errorInvalidJoinCode'],
    ['LOBBY_CLOSED', 'errorLobbyClosed'],
    ['LOBBY_FULL', 'errorLobbyFull'],
    ['PLAYER_NOT_REMOVABLE', 'errorPlayerNotRemovable'],
    ['RATE_LIMITED', 'errorRateLimited'],
    ['TRADE_REQUEST_REQUIRED', 'errorTradeRequestRequired'],
    ['TRADE_REQUEST_NOT_PENDING', 'errorTradeRequestNotPending'],
    ['TRADE_REQUEST_STALE', 'errorTradeRequestStale'],
    ['TRADE_REQUEST_EXISTS', 'errorTradeRequestExists'],
    ['TRADE_REQUEST_NOT_FOUND', 'errorTradeRequestNotFound'],
    ['JOIN_CODE_UNAVAILABLE', 'errorJoinCodeUnavailable'],
    ['UNAUTHORIZED', 'errorSessionExpired'],
    ['INVALID_CREDENTIALS', 'errorInvalidCredentials'],
    ['FORBIDDEN', 'errorForbidden'],
    ['GAME_NOT_MEMBER', 'errorGameAccessDenied'],
    ['INSUFFICIENT_PLAYERS', 'errorInsufficientPlayers'],
    ['INVALID_GAME_STATE', 'errorInvalidGameState'],
    ['RULE_DISABLED', 'errorRuleDisabled'],
    ['JACKPOT_EMPTY', 'errorJackpotEmpty'],
    ['JACKPOT_CHANGED', 'errorJackpotChanged'],
    ['TRANSACTION_NOT_FOUND', 'errorTransactionNotFound'],
    ['TRANSACTION_ALREADY_REVERSED', 'errorTransactionAlreadyReversed'],
    ['TRANSACTION_NOT_REVERSIBLE', 'errorTransactionNotReversible'],
    ['REVERSAL_WINDOW_EXPIRED', 'errorReversalWindowExpired'],
    ['REVERSAL_BLOCKED_BY_LATER_OPERATION', 'errorReversalBlockedByLaterOperation'],
    ['MORTGAGE_ALREADY_ACTIVE', 'errorMortgageAlreadyActive'],
    ['MORTGAGE_NOT_FOUND', 'errorMortgageNotFound'],
    ['INVALID_PROPERTY_NAME', 'errorInvalidPropertyName'],
    ['BANK_LOAN_LIMIT_EXCEEDED', 'errorBankLoanLimitExceeded'],
    ['BANK_TO_PLAYER_LIMIT_EXCEEDED', 'errorBankToPlayerLimitExceeded'],
    ['BANK_LOAN_ALREADY_ACTIVE', 'errorBankLoanAlreadyActive'],
    ['BANK_LOAN_COOLDOWN', 'errorBankLoanCooldown'],
    ['BANK_LOAN_FULL_REPAYMENT_REQUIRED', 'errorBankLoanFullRepayment'],
    ['LOAN_NOT_FOUND', 'errorLoanNotFound'],
    ['LOAN_AMOUNT_EXCEEDS_DEBT', 'errorLoanAmountExceedsDebt'],
    ['AUCTION_ALREADY_ACTIVE', 'errorAuctionAlreadyActive'],
    ['AUCTION_ALREADY_LEADING', 'errorAuctionAlreadyLeading'],
    ['AUCTION_CLOSED', 'errorAuctionClosed'],
    ['AUCTION_BID_STALE', 'errorAuctionBidStale'],
    ['INVALID_BID_STEP', 'errorInvalidBidStep'],
    ['AUCTION_NOT_FOUND', 'errorAuctionNotFound'],
    ['INSUFFICIENT_AVAILABLE_FUNDS', 'errorInsufficientAvailableFunds'],
  ] as const;

  const newlyMapped = [
    'BANKRUPTCY_CREDITOR_SHORT',
    'BOARD_DISABLED',
    'BUILD_MORTGAGED_GROUP',
    'BUILD_REQUIRES_FULL_GROUP',
    'BUILD_UNEVEN',
    'CONFLICT',
    'DATABASE_ERROR',
    'DICE_ROLL_ID_REUSED',
    'DICE_UNAVAILABLE',
    'GAME_FINISHED',
    'GAME_OWNER_REQUIRED',
    'INSUFFICIENT_FUNDS',
    'INVALID_AMOUNT',
    'INVALID_BUILD_TARGET',
    'INVALID_GAME_PASSWORD',
    'INVALID_TRADE',
    'INVITATION_NOT_ACTIVE',
    'LIVE_UNAVAILABLE',
    'MAX_BUILDINGS',
    'NO_BUILDINGS',
    'PLAYER_BANKRUPT',
    'PLAYER_NOT_FOUND',
    'PROPERTY_ALREADY_OWNED',
    'PROPERTY_HAS_BUILDINGS',
    'PROPERTY_IN_AUCTION',
    'PROPERTY_MORTGAGED',
    'PROPERTY_NOT_OWNED',
    'REALTIME_ERROR',
    'SAME_SOURCE_AND_DESTINATION',
    'STATISTICS_UNAVAILABLE',
    'TILE_NOT_BUILDABLE',
    'TILE_NOT_FOUND',
    'TILE_REQUIRED',
  ];

  const failure = (code: string) => new MonopolyBankApiError({ code, message: 'Server message' });

  it.each(mapped)('shows the dedicated message for %s in both languages', (code, key) => {
    for (const language of ['en', 'uk'] as const) {
      const t = (k: Parameters<typeof translate>[1]) => translate(language, k);
      expect(apiErrorMessage(failure(code), t, 'unableJoinGame')).toBe(t(key));
      expect(t(key)).not.toBe('');
      expect(t(key)).not.toBe(t('unableJoinGame'));
    }
  });

  it.each(newlyMapped)('shows a dedicated message for %s in both languages', (code) => {
    for (const language of ['en', 'uk'] as const) {
      const t = (k: Parameters<typeof translate>[1]) => translate(language, k);
      const message = apiErrorMessage(failure(code), t, 'unableJoinGame');
      expect(message).not.toBe('');
      expect(message).not.toBe(t('unableJoinGame'));
    }
  });

  it('does not treat an inherited object property as an error code', () => {
    const t = (k: Parameters<typeof translate>[1]) => translate('en', k);
    expect(apiErrorMessage(failure('constructor'), t, 'unableJoinGame')).toBe(t('unableJoinGame'));
  });

  it('uses the fallback for anything that is not an API error', () => {
    const t = (k: Parameters<typeof translate>[1]) => translate('en', k);
    for (const error of [new Error('boom'), 'text', null, undefined, { code: 'NOT_FOUND' }])
      expect(apiErrorMessage(error, t, 'unableJoinGame')).toBe(t('unableJoinGame'));
  });

  it('picks the fallback the caller asked for', () => {
    const t = (k: Parameters<typeof translate>[1]) => translate('en', k);
    expect(apiErrorMessage(failure('SOME_UNKNOWN_CODE'), t, 'unableAuthenticate')).toBe(
      t('unableAuthenticate'),
    );
  });
});
