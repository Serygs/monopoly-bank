import { describe, expect, it, vi } from 'vitest';
import { loadAccountSession } from './account-session';
import { MonopolyBankApiError } from './monopoly-bank-api';

describe('account session recovery', () => {
  it('shows sign-in only after a confirmed session rejection', async () => {
    const api = {
      currentProfile: vi
        .fn()
        .mockRejectedValue(
          new MonopolyBankApiError({ code: 'UNAUTHORIZED', message: 'Authentication required' }),
        ),
    };
    await expect(loadAccountSession(api)).resolves.toBeNull();
  });

  it.each(['NETWORK_ERROR', 'INTERNAL_ERROR', 'API_ERROR', 'RATE_LIMITED', 'INVALID_CREDENTIALS'])(
    'keeps %s available for retry instead of treating it as logout',
    async (code) => {
      const error = new MonopolyBankApiError({ code, message: 'Temporary error' });
      const currentProfile = vi
        .fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({ id: 'user' });
      await expect(loadAccountSession({ currentProfile })).rejects.toBe(error);
      await expect(loadAccountSession({ currentProfile })).resolves.toEqual({ id: 'user' });
    },
  );
});
