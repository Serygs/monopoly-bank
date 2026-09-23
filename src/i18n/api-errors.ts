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
  // Banking domain (shared/domain/banking-rules.ts, banking.ts).
  INSUFFICIENT_FUNDS: 'insufficientFunds',
  INVALID_AMOUNT: 'errorInvalidAmount',
  PLAYER_BANKRUPT: 'errorPlayerBankrupt',
  PLAYER_NOT_FOUND: 'errorPlayerNotFound',
  SAME_SOURCE_AND_DESTINATION: 'errorSameSourceAndDestination',
  GAME_FINISHED: 'errorGameFinished',
  INCOMPLETE_ESTATE: 'errorIncompleteEstate',
  // Property domain (shared/domain/property.ts).
  PROPERTY_NOT_FOUND: 'errorPropertyNotFound',
  PROPERTY_ALREADY_OWNED: 'errorPropertyAlreadyOwned',
  PROPERTY_NOT_OWNED: 'errorPropertyNotOwned',
  PROPERTY_MORTGAGED: 'errorPropertyMortgaged',
  PROPERTY_NOT_MORTGAGED: 'errorPropertyNotMortgaged',
  INCOMPLETE_COLOR_GROUP: 'errorIncompleteColorGroup',
  UNEVEN_BUILDING: 'errorUnevenBuilding',
  BUILDING_BANK_EMPTY: 'errorBuildingBankEmpty',
  BUILDINGS_PRESENT: 'errorBuildingsPresent',
  BUILDINGS_NOT_ALLOWED: 'errorBuildingsNotAllowed',
  DICE_TOTAL_REQUIRED: 'errorDiceTotalRequired',
  INVALID_DICE_TOTAL: 'errorInvalidDiceTotal',
  // Trade domain (shared/domain/property-trade.ts) and the Worker's trade lookups.
  TRADE_PARTY_MISMATCH: 'errorTradePartyMismatch',
  TRADE_EMPTY: 'errorTradeEmpty',
  TRADE_PROPERTY_NOT_OWNED: 'errorTradePropertyNotOwned',
  TRADE_STATE_CHANGED: 'errorTradeStateChanged',
  TRADE_NOT_FOUND: 'errorTradeNotFound',
  TRADE_NOT_PENDING: 'errorTradeNotPending',
  MORTGAGE_RESOLUTION_REQUIRED: 'errorMortgageResolutionRequired',
  // Jail (shared/domain/jail.ts) and boards (worker/services/board-service.ts).
  PLAYER_NOT_IN_JAIL: 'errorPlayerNotInJail',
  BOARD_IN_USE: 'errorBoardInUse',
  BOARD_NOT_FOUND: 'errorBoardNotFound',
  BOARD_REQUIRED: 'errorBoardRequired',
  BOARD_LIMIT_REACHED: 'errorBoardLimitReached',
};

/** The catalogue key for an API error code, or `null` when the code has no dedicated copy. */
export function apiErrorTranslationKey(code: string): TranslationKey | null {
  return errorKeys[code] ?? null;
}

export function apiErrorMessage(error: unknown, t: Translate, fallback: TranslationKey): string {
  if (!(error instanceof MonopolyBankApiError)) {
    return t(fallback);
  }
  return t(errorKeys[error.code] ?? fallback);
}
