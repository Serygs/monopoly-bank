import { describe, expect, it, vi } from 'vitest';

import { DefaultBankingService } from './banking-service.js';
import type { TransactionRepository } from '../repositories/transaction-repository.js';

describe('DefaultBankingService transaction history', () => {
  it('does not repeat the game lookup after the route has authorized game membership', async () => {
    const listByGameId = vi.fn(async () => []);
    const service = new DefaultBankingService({
      games: { getById: vi.fn() } as never,
      players: {} as never,
      transactions: { listByGameId } as unknown as TransactionRepository,
      operations: {} as never,
      createId: () => 'transaction',
    });

    await expect(service.listTransactions('game', 50)).resolves.toEqual([]);
    expect(listByGameId).toHaveBeenCalledWith('game', 50);
  });
});
