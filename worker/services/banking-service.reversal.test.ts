import { describe, expect, it, vi } from 'vitest';
import {
  InsufficientFundsError,
  TransactionAlreadyReversedError,
  TransactionNotFoundError,
} from '../../shared/domain/banking.js';
import type { Game, Player, Transaction } from '../../shared/types/monopoly.js';
import { defaultGameRules } from '../../shared/types/monopoly.js';
import { DefaultBankingService } from './banking-service.js';
import { DatabaseError } from './errors.js';

const payerId = '11111111-1111-4111-8111-111111111111';
const payeeId = '22222222-2222-4222-8222-222222222222';
const originalId = '33333333-3333-4333-8333-333333333333';

const game: Game = {
  id: 'game',
  name: 'Table',
  startingBalance: 1500,
  passGoReward: 200,
  currency: 'K',
  paymentMode: 'FAST',
  rules: defaultGameRules,
  settings: null,
  status: 'ACTIVE',
  createdAt: '',
  updatedAt: '',
};

const player = (id: string, balance: number): Player => ({
  id,
  gameId: 'game',
  name: id,
  color: '#000',
  balance,
  status: 'ACTIVE',
  createdAt: '',
});

const original: Transaction = {
  id: originalId,
  gameId: 'game',
  type: 'PLAYER_TO_PLAYER',
  amount: 100,
  totalAmount: 100,
  comment: null,
  createdAt: '2026-01-01 10:00:00',
  participants: [
    { playerId: payerId, balanceDelta: -100 },
    { playerId: payeeId, balanceDelta: 100 },
  ],
};

function service(options: { stored?: Transaction | null; payee?: number; persist?: () => void }) {
  const persist = vi.fn(async () => options.persist?.());
  let persisted = false;
  const banking = new DefaultBankingService({
    games: { getById: async () => game } as never,
    players: {
      listByGameId: async () => [player(payerId, 1400), player(payeeId, options.payee ?? 1600)],
    } as never,
    transactions: {
      getById: vi.fn(async (_gameId: string, id: string) => {
        if (id === originalId) return options.stored === undefined ? original : options.stored;
        return persisted ? ({ id } as never) : null;
      }),
    } as never,
    operations: {
      persist: async (input: never) => {
        await persist(input);
        persisted = true;
      },
    } as never,
    paymentRequests: {} as never,
    createId: () => 'reversal-id',
  });
  return { banking, persist };
}

const request = { type: 'REVERSAL' as const, transactionId: originalId, comment: 'Wrong player' };

describe('reversing a transaction', () => {
  it('persists one REVERSAL record that moves the money back and links the original', async () => {
    const { banking, persist } = service({});
    await banking.createTransaction('game', request);

    expect(persist).toHaveBeenCalledOnce();
    const input = (persist.mock.calls[0] as unknown as [never])[0] as {
      transaction: { type: string; reversesTransactionId: string; comment: string };
      balanceChanges: { player: { id: string }; balanceAfter: number }[];
      recentAmount?: number;
    };
    expect(input.transaction).toMatchObject({
      type: 'REVERSAL',
      reversesTransactionId: originalId,
      comment: 'Wrong player',
    });
    expect(input.balanceChanges.map((change) => [change.player.id, change.balanceAfter])).toEqual([
      [payerId, 1500],
      [payeeId, 1500],
    ]);
    // A correction is not a new amount the table "uses", so it stays out of the recent amounts.
    expect(input.recentAmount).toBeUndefined();
  });

  it('reports an unknown transaction without writing', async () => {
    const { banking, persist } = service({ stored: null });
    await expect(banking.createTransaction('game', request)).rejects.toBeInstanceOf(
      TransactionNotFoundError,
    );
    expect(persist).not.toHaveBeenCalled();
  });

  it('refuses a transaction that was already reversed without writing', async () => {
    const { banking, persist } = service({
      stored: { ...original, reversedByTransactionId: 'earlier' },
    });
    await expect(banking.createTransaction('game', request)).rejects.toBeInstanceOf(
      TransactionAlreadyReversedError,
    );
    expect(persist).not.toHaveBeenCalled();
  });

  it('refuses the reversal when the recipient has spent the money, without writing', async () => {
    const { banking, persist } = service({ payee: 30 });
    await expect(banking.createTransaction('game', request)).rejects.toBeInstanceOf(
      InsufficientFundsError,
    );
    expect(persist).not.toHaveBeenCalled();
  });

  it('turns the loser of a reversal race into "already reversed"', async () => {
    let reversed = false;
    const banking = new DefaultBankingService({
      games: { getById: async () => game } as never,
      players: {
        listByGameId: async () => [player(payerId, 1400), player(payeeId, 1600)],
      } as never,
      transactions: {
        getById: async (_gameId: string, id: string) =>
          id === originalId
            ? { ...original, ...(reversed ? { reversedByTransactionId: 'winner' } : {}) }
            : null,
      } as never,
      operations: {
        persist: async () => {
          reversed = true; // the other command committed first
          throw new DatabaseError({
            operation: 'persistBankingOperation',
            cause: new Error('UNIQUE constraint failed'),
          });
        },
      } as never,
      paymentRequests: {} as never,
      createId: () => 'reversal-id',
    });
    await expect(banking.createTransaction('game', request)).rejects.toBeInstanceOf(
      TransactionAlreadyReversedError,
    );
  });

  it('exposes a stored transaction for authorization', async () => {
    const { banking } = service({});
    await expect(banking.getTransaction('game', originalId)).resolves.toEqual(original);
  });
});
