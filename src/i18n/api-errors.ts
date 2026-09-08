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
  FORBIDDEN: 'errorForbidden',
  GAME_NOT_MEMBER: 'errorGameAccessDenied',
  INSUFFICIENT_PLAYERS: 'errorInsufficientPlayers',
  INVALID_GAME_STATE: 'errorInvalidGameState',
};

export function apiErrorMessage(error: unknown, t: Translate, fallback: TranslationKey): string {
  if (!(error instanceof MonopolyBankApiError)) {
    return t(fallback);
  }
  return t(errorKeys[error.code] ?? fallback);
}
