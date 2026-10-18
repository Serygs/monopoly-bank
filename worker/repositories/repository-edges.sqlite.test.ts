// @vitest-environment node
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PendingTransaction, PlayerBalanceChange } from '../../shared/domain/banking.js';
import type { Player } from '../../shared/types/monopoly.js';
import { D1BankingOperationRepository } from './banking-operation-repository.js';
import { D1LoanRepository } from './loan-repository.js';
import { D1MortgageRepository } from './mortgage-repository.js';
import { D1TradeRequestRepository } from './trade-request-repository.js';
import { D1TransactionRepository } from './transaction-repository.js';
import {
  d1,
  migrated,
  rows,
  seedGame,
  seedPlayer,
  seedUser,
} from './test-support/sqlite-d1.test.js';

function change(gameId: string, id: string, before: number, after: number): PlayerBalanceChange {
  const player: Player = {
    id,
    gameId,
    name: id,
    color: '#000',
    balance: before,
    status: 'ACTIVE',
    createdAt: '',
  };
  return { player, balanceBefore: before, balanceAfter: after, balanceDelta: after - before };
}

describe('repository edge cases on SQLite', () => {
  let database: DatabaseSync;

  beforeEach(async () => {
    database = await migrated();
    seedUser(database, 'owner');
    seedGame(database, 'game', { owner: 'owner' });
    seedGame(database, 'other', { owner: 'owner' });
    seedPlayer(database, 'a', 'game', 1000);
    seedPlayer(database, 'b', 'game', 1000);
    seedPlayer(database, 'x', 'other', 1000);
  });

  describe('transactions', () => {
    it('refuses a transaction without participants and writes nothing', async () => {
      const repository = new D1TransactionRepository(d1(database));
      await expect(
        repository.create({
          id: 't1',
          gameId: 'game',
          type: 'PLAYER_TO_BANK',
          amount: 10,
          totalAmount: 10,
          participants: [],
        }),
      ).rejects.toThrow('A transaction must include at least one player participant.');
      expect(rows(database, 'SELECT id FROM transactions')).toEqual([]);
    });

    it('stores a transaction with its participants and a null comment by default', async () => {
      const repository = new D1TransactionRepository(d1(database));
      await repository.create({
        id: 't1',
        gameId: 'game',
        type: 'PLAYER_TO_BANK',
        amount: 10,
        totalAmount: 10,
        participants: [{ playerId: 'a', balanceDelta: -10 }],
      });
      expect(rows(database, 'SELECT id, comment FROM transactions')).toEqual([
        { id: 't1', comment: null },
      ]);
      expect(
        rows(database, 'SELECT player_id, balance_delta FROM transaction_participants'),
      ).toEqual([{ player_id: 'a', balance_delta: -10 }]);
      const stored = await repository.getById('game', 't1');
      expect(stored).toMatchObject({
        id: 't1',
        participants: [{ playerId: 'a', balanceDelta: -10 }],
      });
      expect(stored).not.toHaveProperty('tileId');
      expect(stored).not.toHaveProperty('initiatorPlayerId');
    });

    it('returns no transactions for an empty anchor list even when the game has some', async () => {
      const repository = new D1TransactionRepository(d1(database));
      await repository.create({
        id: 't1',
        gameId: 'game',
        type: 'PLAYER_TO_BANK',
        amount: 10,
        totalAmount: 10,
        participants: [{ playerId: 'a', balanceDelta: -10 }],
      });
      expect(await repository.listChronologicalSince('game', [])).toEqual([]);
      expect(
        (await repository.listChronologicalSince('game', ['t1'])).map((item) => item.id),
      ).toEqual(['t1']);
    });
  });

  describe('trade requests', () => {
    const trade = {
      id: 'tr1',
      gameId: 'game',
      proposerPlayerId: 'a',
      counterpartyPlayerId: 'b',
      giveTileIds: [],
      takeTileIds: [],
      cashGive: 50,
      cashTake: 0,
      state: 'PENDING' as const,
      expiresAt: '2000-01-01T00:00:00.000Z',
    };

    it('lists nothing for no wallets without expiring requests, and resolves once', async () => {
      const repository = new D1TradeRequestRepository(d1(database));
      await repository.create(trade);
      expect(await repository.listPendingForPlayers('game', [])).toEqual([]);
      expect(rows<{ state: string }>(database, 'SELECT state FROM trade_requests')[0].state).toBe(
        'PENDING',
      );
      expect(await repository.resolve('tr1', 'DECLINED')).toBe(true);
      expect(await repository.resolve('tr1', 'CANCELLED')).toBe(false);
      expect(await repository.resolve('missing', 'CANCELLED')).toBe(false);
      expect(rows<{ state: string }>(database, 'SELECT state FROM trade_requests')[0].state).toBe(
        'DECLINED',
      );
    });
  });

  describe('mortgages and loans', () => {
    it('finds nothing for an unknown redemption or inactive records', async () => {
      expect(
        await new D1MortgageRepository(d1(database)).findRedeemedBy('game', 'nope'),
      ).toBeNull();
      expect(await new D1MortgageRepository(d1(database)).getActive('game', 'nope')).toBeNull();
      expect(await new D1LoanRepository(d1(database)).getActive('game', 'nope')).toBeNull();
    });
  });

  describe('banking operations', () => {
    const operation: PendingTransaction = {
      gameId: 'game',
      type: 'PLAYER_TO_PLAYER',
      amount: 10,
      totalAmount: 10,
      comment: null,
      participants: [
        { playerId: 'a', balanceDelta: -10 },
        { playerId: 'b', balanceDelta: 10 },
      ],
    };

    it('refuses balance changes that span two games before writing anything', async () => {
      const repository = new D1BankingOperationRepository(d1(database));
      await expect(
        repository.persist({
          transactionId: 't1',
          transaction: operation,
          balanceChanges: [change('game', 'a', 1000, 990), change('other', 'x', 1000, 1010)],
        }),
      ).rejects.toThrow('All balance changes must belong to the same game.');
      expect(
        rows<{ balance: number }>(database, 'SELECT balance FROM players ORDER BY id').map(
          (row) => row.balance,
        ),
      ).toEqual([1000, 1000, 1000]);
      expect(rows(database, 'SELECT id FROM transactions')).toEqual([]);
    });

    it('reports a failed batch as a database error and leaves balances untouched', async () => {
      const repository = new D1BankingOperationRepository(d1(database));
      await expect(
        repository.persist({
          transactionId: 't1',
          transaction: operation,
          balanceChanges: [change('game', 'a', 500, 490), change('game', 'b', 1000, 1010)],
        }),
      ).rejects.toMatchObject({
        code: 'DATABASE_ERROR',
        operation: 'persistBankingOperation',
        message: 'Internal server error.',
      });
      expect(
        rows<{ balance: number }>(
          database,
          "SELECT balance FROM players WHERE game_id = 'game' ORDER BY id",
        ).map((row) => row.balance),
      ).toEqual([1000, 1000]);
      expect(rows(database, 'SELECT id FROM transactions')).toEqual([]);
    });

    it('persists a transaction without balance changes', async () => {
      const repository = new D1BankingOperationRepository(d1(database));
      await repository.persist({
        transactionId: 't1',
        transaction: { ...operation, participants: [{ playerId: 'a', balanceDelta: 10 }] },
        balanceChanges: [],
      });
      expect(rows(database, 'SELECT id FROM transactions')).toEqual([{ id: 't1' }]);
    });
  });
});
