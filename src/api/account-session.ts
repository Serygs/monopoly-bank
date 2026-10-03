import type { UserProfile } from '../../shared/contracts/api';
import { MonopolyBankApiError, type MonopolyBankApi } from './monopoly-bank-api';

/** Only the server's session rejection establishes that sign-in is needed. */
export async function loadAccountSession(
  api: Pick<MonopolyBankApi, 'currentProfile'>,
): Promise<UserProfile | null> {
  try {
    return await api.currentProfile();
  } catch (error) {
    if (error instanceof MonopolyBankApiError && error.code === 'UNAUTHORIZED') return null;
    throw error;
  }
}
