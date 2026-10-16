// @vitest-environment node
import { readdir, readFile } from 'node:fs/promises';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  passGo,
  playerToPlayer,
  reverseTransaction,
  type BankingOperationResult,
} from '../../shared/domain/banking.js';
import { defaultGameRules, type Game, type Player } from '../../shared/types/monopoly.js';
import { D1BankingOperationRepository } from './banking-operation-repository.js';
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

describe('persisted game statistics', () => {
  let database: DatabaseSync;
  let operations: D1BankingOperationRepository;
  let transactions: D1TransactionRepository;
  let statistics: D1GameStatisticsRepository;

  beforeEach(async () => {
    database = await migrated();
    database.exec(
      `INSERT INTO games (id, name, starting_balance, pass_go_reward, currency, status, payment_mode)
       VALUES ('game', 'Stats', 1500, 200, 'K', 'ACTIVE', 'FAST');
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
  const goPass = (id: string, playerId: string, exactLanding = false) =>
    persist(id, passGo({ game, players: players(), playerId, exactLanding }));
  const passGoCounts = async () =>
    Object.fromEntries(
      (await statistics.calculate(game, players())).cashLeaderboard.map((entry) => [
        entry.player.id,
        entry.passGoCount,
      ]),
    );

  it('counts every GO pass of a player, including exact landings', async () => {
    await goPass('t1', 'a');
    await goPass('t2', 'a', true);
    await goPass('t3', 'b');
    expect(await passGoCounts()).toEqual({ a: 2, b: 1 });
  });

  it('keeps counting GO passes next to other operations', async () => {
    await goPass('t1', 'a');
    await persist(
      't2',
      playerToPlayer({
        game,
        players: players(),
        sourcePlayerId: 'a',
        destinationPlayerId: 'b',
        amount: 50,
      }),
    );
    await goPass('t3', 'b');
    expect(await passGoCounts()).toEqual({ a: 1, b: 1 });
  });

  it('does not count a GO pass that was reversed', async () => {
    await goPass('t1', 'a');
    await goPass('t2', 'a');
    const original = await transactions.getById('game', 't1');
    if (original === null) throw new Error('missing original');
    await persist('r1', reverseTransaction({ game, players: players(), original }));
    expect(await passGoCounts()).toEqual({ a: 1, b: 0 });
  });
});

describe('persisted award statistics', () => {
  it('derives awards and the balance series from the ledger, skipping reversed rows', async () => {
    const database = await migrated();
    database.exec(
      `INSERT INTO games (id, name, starting_balance, pass_go_reward, currency, status, payment_mode)
       VALUES ('game', 'Stats', 1500, 200, 'K', 'ACTIVE', 'FAST');
       INSERT INTO players (id, game_id, name, color, balance) VALUES
         ('a', 'game', 'Ada', '#111111', 1500), ('b', 'game', 'Bo', '#222222', 1500)`,
    );
    const db = d1(database);
    const operations = new D1BankingOperationRepository(db);
    const statistics = new D1GameStatisticsRepository(db);
    const current = (): Player[] =>
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
    const run = (id: string, result: BankingOperationResult) =>
      operations.persist({
        transactionId: id,
        transaction: result.transaction,
        balanceChanges: result.affectedPlayers,
      });
    await run(
      't1',
      playerToPlayer({
        game,
        players: current(),
        sourcePlayerId: 'a',
        destinationPlayerId: 'b',
        amount: 300,
      }),
    );
    await run('t2', passGo({ game, players: current(), playerId: 'a' }));
    const summary = await statistics.calculate(game, current());
    expect(summary.awards?.rentPaid).toEqual({ playerId: 'a', amount: 300 });
    expect(summary.awards?.rentCollected).toEqual({ playerId: 'b', amount: 300 });
    expect(summary.awards?.biggestOperation).toEqual({
      type: 'PLAYER_TO_PLAYER',
      amount: 300,
      playerId: 'a',
    });
    expect(summary.balanceSeries).toEqual({
      steps: 2,
      players: [
        { playerId: 'a', balances: [1500, 1200, 1400] },
        { playerId: 'b', balances: [1500, 1800, 1800] },
      ],
    });
  });
});
