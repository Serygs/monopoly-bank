// @vitest-environment node
import { readdir, readFile } from 'node:fs/promises';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  declareBankruptcy,
  jackpotPayout,
  toJackpot,
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
  name: 'Jackpot',
  startingBalance: 1500,
  passGoReward: 200,
  currency: 'K',
  paymentMode: 'FAST',
  rules: { ...defaultGameRules, freeParkingJackpot: true },
  settings: null,
  status: 'ACTIVE',
  createdAt: '',
  updatedAt: '',
  startedAt: '2026-01-01T00:00:00.000Z',
  finishedAt: null,
};

describe('persisted Free Parking jackpot', () => {
  let database: DatabaseSync;
  let operations: D1BankingOperationRepository;
  let games: D1GameRepository;

  beforeEach(async () => {
    database = await migrated();
    database.exec(
      `INSERT INTO games (id, name, starting_balance, pass_go_reward, currency, status, payment_mode, rule_jackpot)
       VALUES ('game', 'Jackpot', 1500, 200, 'K', 'ACTIVE', 'FAST', 1);
       INSERT INTO players (id, game_id, name, color, balance) VALUES
         ('a', 'game', 'Ada', '#111111', 1500), ('b', 'game', 'Bo', '#222222', 1500),
         ('c', 'game', 'Cy', '#333333', 100)`,
    );
    const db = d1(database);
    operations = new D1BankingOperationRepository(db);
    games = new D1GameRepository(db);
  });

  const players = (): Player[] =>
    (
      database.prepare('SELECT id, balance, status FROM players ORDER BY id').all() as {
        id: string;
        balance: number;
        status: Player['status'];
      }[]
    ).map((row) => ({
      id: row.id,
      gameId: 'game',
      name: row.id,
      color: '#000',
      balance: row.balance,
      status: row.status,
      createdAt: '',
    }));

  const balances = () =>
    (database.prepare('SELECT id, balance FROM players ORDER BY id').all() as unknown[]).map(
      (row) => Object.values(row as object),
    );

  const count = (table: string) =>
    (database.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number }).total;

  const persist = (id: string, result: BankingOperationResult, recentAmount?: number) =>
    operations.persist({
      transactionId: id,
      transaction: result.transaction,
      balanceChanges: result.affectedPlayers,
      ...(recentAmount === undefined ? {} : { recentAmount }),
    });

  const payIn = (id: string, playerId: string, amount: number, comment = 'Income tax') =>
    persist(id, toJackpot({ game, players: players(), playerId, amount, comment }), amount);

  async function collect(id: string, playerId: string) {
    return persist(
      id,
      jackpotPayout({
        game,
        players: players(),
        playerId,
        jackpot: await games.getJackpot('game'),
        expectedAmount: await games.getJackpot('game'),
      }),
    );
  }

  it('starts empty', async () => {
    expect(await games.getJackpot('game')).toBe(0);
    expect(await games.getJackpot('missing')).toBe(0);
  });

  it('moves the payment into the pot with its transaction', async () => {
    await payIn('t1', 'a', 200);
    await payIn('t2', 'b', 75, 'Luxury tax');

    expect(await games.getJackpot('game')).toBe(275);
    expect(balances()).toEqual([
      ['a', 1300],
      ['b', 1425],
      ['c', 100],
    ]);
    const stored = await new D1TransactionRepository(d1(database)).getById('game', 't1');
    expect(stored).toMatchObject({
      type: 'TO_JACKPOT',
      amount: 200,
      totalAmount: 200,
      comment: 'Income tax',
      participants: [{ playerId: 'a', balanceDelta: -200 }],
    });
  });

  it('pays the whole pot to the collector and empties it', async () => {
    await payIn('t1', 'a', 200);
    await payIn('t2', 'b', 75);
    await collect('t3', 'c');

    expect(await games.getJackpot('game')).toBe(0);
    expect(balances()).toEqual([
      ['a', 1300],
      ['b', 1425],
      ['c', 375],
    ]);
    const stored = await new D1TransactionRepository(d1(database)).getById('game', 't3');
    expect(stored).toMatchObject({
      type: 'JACKPOT_PAYOUT',
      amount: 275,
      totalAmount: 275,
      participants: [{ playerId: 'c', balanceDelta: 275 }],
    });
  });

  it('rolls a payout back when the pot changed after it was read', async () => {
    await payIn('t1', 'a', 200);
    const stale = jackpotPayout({
      game,
      players: players(),
      playerId: 'c',
      jackpot: 200,
      expectedAmount: 200,
    });
    await payIn('t2', 'b', 50); // the pot is now 250

    await expect(persist('t3', stale)).rejects.toMatchObject({ name: 'DatabaseError' });

    expect(await games.getJackpot('game')).toBe(250);
    expect(balances()).toEqual([
      ['a', 1300],
      ['b', 1450],
      ['c', 100],
    ]);
    expect(count('transactions')).toBe(2);
    expect(count('transaction_participants')).toBe(2);
  });

  it('rolls a second collection of the same pot back', async () => {
    await payIn('t1', 'a', 200);
    const first = jackpotPayout({
      game,
      players: players(),
      playerId: 'b',
      jackpot: 200,
      expectedAmount: 200,
    });
    const second = jackpotPayout({
      game,
      players: players(),
      playerId: 'c',
      jackpot: 200,
      expectedAmount: 200,
    });
    await persist('t2', first);

    await expect(persist('t3', second)).rejects.toMatchObject({ name: 'DatabaseError' });

    expect(await games.getJackpot('game')).toBe(0);
    expect(balances()).toEqual([
      ['a', 1300],
      ['b', 1700],
      ['c', 100],
    ]);
    expect(count('transactions')).toBe(2);
  });

  it('leaves the pot unchanged when the payer balance moved meanwhile', async () => {
    const stale = toJackpot({ game, players: players(), playerId: 'a', amount: 200 });
    database.exec("UPDATE players SET balance = 50 WHERE id = 'a'");

    await expect(persist('t1', stale)).rejects.toMatchObject({ name: 'DatabaseError' });

    expect(await games.getJackpot('game')).toBe(0);
    expect(count('transactions')).toBe(0);
  });

  it('refuses a payment the wallet cannot cover before anything is written', () => {
    expect(() => toJackpot({ game, players: players(), playerId: 'c', amount: 101 })).toThrow(
      expect.objectContaining({ code: 'INSUFFICIENT_FUNDS' }),
    );
    expect(count('transactions')).toBe(0);
  });

  it('keeps the pot when a player goes bankrupt', async () => {
    await payIn('t1', 'a', 200);
    const result = declareBankruptcy({
      game,
      players: players(),
      playerId: 'b',
      creditorPlayerId: 'a',
    });
    await operations.persist({
      transactionId: 't2',
      transaction: result.transaction,
      balanceChanges: result.affectedPlayers,
      bankruptPlayerId: 'b',
      mortgageHeirPlayerId: 'a',
      loanHeirPlayerId: 'a',
    });

    expect(await games.getJackpot('game')).toBe(200);
  });

  it('counts pot payments as sent and received, never as bank or player-to-player money', async () => {
    await payIn('t1', 'a', 200);
    await payIn('t2', 'b', 75);
    await collect('t3', 'c');

    const summary = await new D1GameStatisticsRepository(d1(database)).calculate(game, players());

    expect(summary.totalTransactions).toBe(3);
    expect(summary.totalMoneyTransferred).toBe(200 + 75 + 275);
    expect(summary.playerToPlayerTotal).toBe(0);
    expect(summary.paidToBank).toBe(0);
    expect(summary.receivedFromBank).toBe(0);
    const byId = new Map(summary.cashLeaderboard.map((entry) => [entry.player.id, entry]));
    expect(byId.get('a')).toMatchObject({ sent: 200, received: 0 });
    expect(byId.get('b')).toMatchObject({ sent: 75, received: 0 });
    expect(byId.get('c')).toMatchObject({ sent: 0, received: 275 });
  });

  it('still deletes a game, and purges an expired one, that holds a pot', async () => {
    await payIn('t1', 'a', 200);
    await collect('t2', 'b');
    await payIn('t3', 'a', 50);

    expect(await games.softDelete('game')).toBe(true);
    database.exec(
      "UPDATE games SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-31 days') WHERE id = 'game'",
    );
    await games.purgeExpiredDeleted();

    for (const table of ['games', 'transactions', 'transaction_participants', 'players'])
      expect(count(table)).toBe(0);
  });

  it('can delete a game with a pot outright', async () => {
    await payIn('t1', 'a', 200);

    expect(await games.delete('game')).toBe(true);
    expect(count('transactions')).toBe(0);
  });
});
