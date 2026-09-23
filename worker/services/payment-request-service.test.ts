import { describe, expect, it, vi } from 'vitest';
import { DefaultBankingService } from './banking-service.js';
import type { PaymentRequest } from '../../shared/contracts/api.js';
import type { Game, Player, Transaction } from '../../shared/types/monopoly.js';

const game: Game = {
  id: 'game',
  name: 'Table',
  startingBalance: 500,
  passGoReward: 200,
  currency: 'K',
  paymentMode: 'CONFIRMATION',
  status: 'ACTIVE',
  createdAt: '',
  updatedAt: '',
};
const players: Player[] = [
  { id: 'payer', gameId: game.id, name: 'Payer', color: '#1', balance: 500, createdAt: '' },
  { id: 'recipient', gameId: game.id, name: 'Recipient', color: '#2', balance: 500, createdAt: '' },
];

describe('confirmation payment requests', () => {
  it('reserves a direct payment without ledger write and settles exactly once on repeat accept', async () => {
    const requests = new Map<string, PaymentRequest>();
    const transactions = new Map<string, Transaction>();
    const operations = { persist: vi.fn() };
    let ids = 0;
    const service = new DefaultBankingService({
      games: { getById: async () => game, recordRecentAmount: vi.fn() } as never,
      players: { listByGameId: async () => players } as never,
      transactions: {
        getById: async (_gameId: string, id: string) => transactions.get(id) ?? null,
      } as never,
      operations: operations as never,
      paymentRequests: {
        create: async (
          request: Omit<PaymentRequest, 'createdAt' | 'resolvedAt' | 'transactionId'>,
        ) => {
          requests.set(request.id, {
            ...request,
            createdAt: '',
            resolvedAt: null,
            transactionId: null,
          });
        },
        getById: async (_gameId: string, id: string) => requests.get(id) ?? null,
        pendingReservedAmount: async () =>
          [...requests.values()]
            .filter((request) => request.state === 'PENDING')
            .reduce((sum, request) => sum + request.amount, 0),
        expirePending: async () => undefined,
        listForPayers: async () => [],
        settle: async ({ requestId, transactionId, transaction, balanceChanges }) => {
          const request = requests.get(requestId);
          if (request === undefined || request.state !== 'PENDING')
            throw new Error('already settled');
          requests.set(requestId, { ...request, state: 'ACCEPTED', transactionId });
          transactions.set(transactionId, { id: transactionId, ...transaction, createdAt: '' });
          for (const change of balanceChanges) change.player.balance = change.balanceAfter;
        },
        resolve: async () => true,
      },
      createId: () => `id-${++ids}`,
    });

    const created = await service.createTransaction(game.id, {
      type: 'PLAYER_TO_PLAYER',
      sourcePlayerId: 'payer',
      destinationPlayerId: 'recipient',
      amount: 150,
    });
    expect('paymentRequests' in created).toBe(true);
    expect(operations.persist).not.toHaveBeenCalled();
    expect(players.map((player) => player.balance)).toEqual([500, 500]);
    const requestId = 'paymentRequests' in created ? created.paymentRequests[0]?.id : '';

    const accepted = await service.acceptPaymentRequest(game.id, requestId ?? '');
    const replay = await service.acceptPaymentRequest(game.id, requestId ?? '');
    expect(accepted.transaction?.id).toBe(replay.transaction?.id);
    expect(transactions.size).toBe(1);
    expect(players.map((player) => player.balance)).toEqual([350, 650]);
  });

  it('does not settle when the payer no longer has funds', async () => {
    const request: PaymentRequest = {
      id: 'request',
      gameId: game.id,
      payerPlayerId: 'payer',
      recipientPlayerId: 'recipient',
      creatorPlayerId: 'payer',
      approverPlayerId: 'recipient',
      amount: 100,
      comment: null,
      state: 'PENDING',
      expiresAt: '2999-01-01T00:00:00.000Z',
      createdAt: '',
      resolvedAt: null,
      transactionId: null,
    };
    players[0]!.balance = 50;
    const settle = vi.fn();
    const service = new DefaultBankingService({
      games: { getById: async () => game } as never,
      players: { listByGameId: async () => players } as never,
      transactions: {} as never,
      operations: {} as never,
      paymentRequests: {
        getById: async () => request,
        expirePending: async () => undefined,
        settle,
        create: async () => undefined,
        listForPayers: async () => [],
        pendingReservedAmount: async () => 0,
        resolve: async () => true,
      },
      createId: () => 'transaction',
    });
    await expect(service.acceptPaymentRequest(game.id, request.id)).rejects.toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
    });
    expect(settle).not.toHaveBeenCalled();
  });
});
