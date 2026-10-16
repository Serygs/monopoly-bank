import { MonopolyBankApiError } from '../api/monopoly-bank-api';
import type { Translate, TranslationKey } from './translations';

const errorKeys: Record<string, TranslationKey> = {
  NETWORK_ERROR: 'errorNetwork',
  API_ERROR: 'errorUnexpected',
  VALIDATION_ERROR: 'errorValidation',
  NOT_FOUND: 'errorNotFound',
  PERSISTENCE_ERROR: 'errorPersistence',
  INTERNAL_ERROR: 'errorUnexpected',
  EMAIL_DELIVERY_UNAVAILABLE: 'errorEmailDelivery',
  ACCOUNT_IDENTIFIER_UNAVAILABLE: 'errorNicknameTaken',
  INVALID_JOIN_CODE: 'errorInvalidJoinCode',
  LOBBY_CLOSED: 'errorLobbyClosed',
  RATE_LIMITED: 'errorRateLimited',
  UNAUTHORIZED: 'errorSessionExpired',
  INVALID_CREDENTIALS: 'errorInvalidCredentials',
  FORBIDDEN: 'errorForbidden',
  GAME_NOT_MEMBER: 'errorGameAccessDenied',
  INSUFFICIENT_PLAYERS: 'errorInsufficientPlayers',
  INVALID_GAME_STATE: 'errorInvalidGameState',
  RULE_DISABLED: 'errorRuleDisabled',
  TRANSACTION_NOT_FOUND: 'errorTransactionNotFound',
  TRANSACTION_ALREADY_REVERSED: 'errorTransactionAlreadyReversed',
  TRANSACTION_NOT_REVERSIBLE: 'errorTransactionNotReversible',
  REVERSAL_WINDOW_EXPIRED: 'errorReversalWindowExpired',
  MORTGAGE_ALREADY_ACTIVE: 'errorMortgageAlreadyActive',
  MORTGAGE_NOT_FOUND: 'errorMortgageNotFound',
  INVALID_PROPERTY_NAME: 'errorInvalidPropertyName',
  BANK_LOAN_LIMIT_EXCEEDED: 'errorBankLoanLimitExceeded',
  BANK_LOAN_ALREADY_ACTIVE: 'errorBankLoanAlreadyActive',
  BANK_LOAN_COOLDOWN: 'errorBankLoanCooldown',
  BANK_LOAN_FULL_REPAYMENT_REQUIRED: 'errorBankLoanFullRepayment',
  LOAN_NOT_FOUND: 'errorLoanNotFound',
  LOAN_AMOUNT_EXCEEDS_DEBT: 'errorLoanAmountExceedsDebt',
};

export function apiErrorMessage(error: unknown, t: Translate, fallback: TranslationKey): string {
  if (!(error instanceof MonopolyBankApiError)) {
    return t(fallback);
  }
  return t(errorKeys[error.code] ?? fallback);
}
