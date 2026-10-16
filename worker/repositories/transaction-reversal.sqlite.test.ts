// @vitest-environment node
import { readdir, readFile } from 'node:fs/promises';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  playerToPlayer,
  reverseTransaction,
  type BankingOperationResult,
} from '../../shared/domain/banking.js';
import { defaultGameRules, type Game, type Player } from '../../shared/types/monopoly.js';
import { D1BankingOperationRepository } from './banking-operation-repository.js';
import { D1GameRepository } from './game-repository.js';
import { D1GameStatisticsRepository } from './game-statistics-repository.js';
import { D1TransactionRepository } from './transaction-repository.js';

/** The slice of D1 the repositories use, backed by a real SQLite database. */
function d1(database: DatabaseSync): D1Database {
  const prepare = (sql: string) => {
    let values: SQLInputValue[] = [];
    const statement = {
      bind: (...next: unknown[]) => {
        values = next as SQLInputValue[];
        return statement;
      },
      first: async () => (database.prepare(sql).get(...values) as unknown) ?? null,
      all: async () => ({ results: database.prepare(sql).all(...values) as unknown[] }),
      run: async () => {
        const result = database.prepare(sql).run(...values);
        return { meta: { changes: Number(result.changes) } };
      },
    };
    return statement;
  };
  // D1 runs a batch as one transaction: either every statement applies or none does.
  const batch = async (statements: { run: () => Promise<unknown> }[]) => {
    database.exec('BEGIN');
    try {
      const results: unknown[] = [];
      for (const statement of statements) results.push(await statement.run());
      database.exec('COMMIT');
      return results;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  };
  return { prepare, batch } as unknown as D1Database;
}

async function migrated(): Promise<DatabaseSync> {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  const directory = new URL('../../migrations/', import.meta.url);
  const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  for (const name of files) database.exec(await readFile(new URL(name, directory), 'utf8'));
  return database;
}

const game: Game = {
  id: 'game',
  name: 'Reversals',
  startingBalance: 1500,
  passGoReward: 200,
  currency: 'K',
  paymentMode: 'FAST',
  rules: defaultGameRules,
  settings: null,
  status: 'ACTIVE',
  createdAt: '',
  updatedAt: '',
  startedAt: '2026-01-01T00:00:00.000Z',
  finishedAt: null,
};

describe('persisted reversals', () => {
  let database: DatabaseSync;
  let operations: D1BankingOperationRepository;
  let transactions: D1TransactionRepository;
  let statistics: D1GameStatisticsRepository;

  beforeEach(async () => {
    database = await migrated();
    database.exec(
      `INSERT INTO games (id, name, starting_balance, pass_go_reward, currency, status, payment_mode)
       VALUES ('game', 'Reversals', 1500, 200, 'K', 'ACTIVE', 'FAST');
       INSERT INTO players (id, game_id, name, color, balance) VALUES
         ('a', 'game', 'Ada', '#111111', 1500), ('b', 'game', 'Bo', '#222222', 1500)`,
    );
    const db = d1(database);
    operations = new D1BankingOperationRepository(db);
    transactions = new D1TransactionRepository(db);
    statistics = new D1GameStatisticsRepository(db);
  });

  const players = (): Player[] =>
    (
      database.prepare('SELECT id, balance FROM players ORDER BY id').all() as {
        id: string;
        balance: number;
      }[]
    ).map((row) => ({
      id: row.id,
      gameId: 'game',
      name: row.id,
      color: '#000',
      balance: row.balance,
      status: 'ACTIVE',
      createdAt: '',
    }));

  const persist = (id: string, result: BankingOperationResult) =>
    operations.persist({
      transactionId: id,
      transaction: result.transaction,
      balanceChanges: result.affectedPlayers,
    });

  const balances = () =>
    (database.prepare('SELECT id, balance FROM players ORDER BY id').all() as unknown[]).map(
      (row) => Object.values(row as object),
    );

  async function pay(id: string, amount: number): Promise<void> {
    await persist(
      id,
      playerToPlayer({
        game,
        players: players(),
        sourcePlayerId: 'a',
        destinationPlayerId: 'b',
        amount,
      }),
    );
  }

  async function reverse(reversalId: string, originalId: string): Promise<void> {
    const original = await transactions.getById('game', originalId);
    if (original === null) throw new Error('missing original');
    await persist(reversalId, reverseTransaction({ game, players: players(), original }));
  }

  it('restores both balances and links the two records', async () => {
    await pay('payment', 300);
    expect(balances()).toEqual([
      ['a', 1200],
      ['b', 1800],
    ]);

    await reverse('reversal', 'payment');

    expect(balances()).toEqual([
      ['a', 1500],
      ['b', 1500],
    ]);
    expect(await transactions.getById('game', 'payment')).toMatchObject({
      type: 'PLAYER_TO_PLAYER',
      reversesTransactionId: null,
      reversedByTransactionId: 'reversal',
    });
    expect(await transactions.getById('game', 'reversal')).toMatchObject({
      type: 'REVERSAL',
      amount: 300,
      reversesTransactionId: 'payment',
      reversedByTransactionId: null,
      participants: [
        { playerId: 'a', balanceDelta: 300 },
        { playerId: 'b', balanceDelta: -300 },
      ],
    });
  });

  it('rolls back a second reversal of the same transaction, leaving every balance alone', async () => {
    await pay('payment', 300);
    await reverse('first', 'payment');
    await pay('again', 100);
    const before = balances();
    const original = (await transactions.getById('game', 'payment'))!;
    // Build the competing reversal as if it was prepared before `first` committed.
    const stale = reverseTransaction({
      game,
      players: players(),
      original: { ...original, reversedByTransactionId: null },
    });

    await expect(persist('second', stale)).rejects.toThrow();

    expect(balances()).toEqual(before);
    expect(await transactions.getById('game', 'second')).toBeNull();
  });

  it('keeps both records in the history, newest first', async () => {
    await pay('payment', 300);
    await reverse('reversal', 'payment');

    const history = await transactions.listByGameId('game');
    expect(history.map((transaction) => transaction.id)).toEqual(['reversal', 'payment']);
  });

  it('counts a reversed payment and its reversal as nothing moved', async () => {
    await pay('kept', 100);
    await pay('mistake', 300);
    await reverse('reversal', 'mistake');

    const summary = await statistics.calculate(game, players());

    expect(summary.totalTransactions).toBe(1);
    expect(summary.totalMoneyTransferred).toBe(100);
    expect(summary.largestSinglePayment).toBe(100);
    const ada = summary.players.find((entry) => entry.player.id === 'a');
    expect(ada).toMatchObject({ totalPaid: 100, transactionCount: 1 });
  });

  it('still deletes a game, and purges an expired deleted one, that holds a reversal', async () => {
    const games = new D1GameRepository(d1(database));
    await pay('payment', 300);
    await reverse('reversal', 'payment');

    expect(await games.softDelete('game')).toBe(true);
    database.exec(
      "UPDATE games SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-31 days') WHERE id = 'game'",
    );
    await games.purgeExpiredDeleted();

    const left = database.prepare('SELECT COUNT(*) AS total FROM transactions').get() as {
      total: number;
    };
    expect(left.total).toBe(0);
  });
});
