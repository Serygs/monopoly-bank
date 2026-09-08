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
};

export function apiErrorMessage(error: unknown, t: Translate, fallback: TranslationKey): string {
  if (!(error instanceof MonopolyBankApiError)) {
    return t(fallback);
  }
  return t(errorKeys[error.code] ?? fallback);
}
