// @vitest-environment node
import { readdir, readFile } from 'node:fs/promises';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  declareBankruptcy,
  mortgageProperty,
  redeemMortgage,
  reverseTransaction,
  type BankingOperationResult,
} from '../../shared/domain/banking.js';
import { defaultGameRules, type Game, type Player } from '../../shared/types/monopoly.js';
import { D1BankingOperationRepository } from './banking-operation-repository.js';
import { D1GameRepository } from './game-repository.js';
import { D1GameStatisticsRepository } from './game-statistics-repository.js';
import { D1MortgageRepository } from './mortgage-repository.js';
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
  name: 'Mortgages',
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

describe('persisted mortgages', () => {
  let database: DatabaseSync;
  let operations: D1BankingOperationRepository;
  let mortgages: D1MortgageRepository;
  let transactions: D1TransactionRepository;

  beforeEach(async () => {
    database = await migrated();
    database.exec(
      `INSERT INTO games (id, name, starting_balance, pass_go_reward, currency, status, payment_mode)
       VALUES ('game', 'Mortgages', 1500, 200, 'K', 'ACTIVE', 'FAST');
       INSERT INTO players (id, game_id, name, color, balance) VALUES
         ('a', 'game', 'Ada', '#111111', 1500), ('b', 'game', 'Bo', '#222222', 1500)`,
    );
    const db = d1(database);
    operations = new D1BankingOperationRepository(db);
    mortgages = new D1MortgageRepository(db);
    transactions = new D1TransactionRepository(db);
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

  const mortgage = (id: string, propertyName: string, playerId = 'a', amount = 400) =>
    persist(id, mortgageProperty({ game, players: players(), playerId, propertyName, amount }));

  async function redeem(id: string, mortgageId: string, playerId = 'a') {
    const active = await mortgages.getActive('game', mortgageId);
    if (active === null) throw new Error('mortgage is not active');
    await persist(id, redeemMortgage({ game, players: players(), playerId, mortgage: active }));
  }

  it('pays the bank amount and lists the property as mortgaged', async () => {
    await mortgage('m1', 'Boardwalk');

    expect(balances()).toEqual([
      ['a', 1900],
      ['b', 1500],
    ]);
    expect(await mortgages.listActive('game')).toEqual([
      expect.objectContaining({
        id: 'm1',
        playerId: 'a',
        propertyName: 'Boardwalk',
        mortgageValue: 400,
      }),
    ]);
    expect(await transactions.getById('game', 'm1')).toMatchObject({
      type: 'MORTGAGE',
      comment: 'Boardwalk',
      amount: 400,
    });
  });

  it('charges the value plus 10% to redeem and stops listing it', async () => {
    await mortgage('m1', 'Boardwalk');
    await redeem('r1', 'm1');

    expect(balances()).toEqual([
      ['a', 1460],
      ['b', 1500],
    ]);
    expect(await mortgages.listActive('game')).toEqual([]);
    expect(await mortgages.getActive('game', 'm1')).toBeNull();
    expect(await transactions.getById('game', 'r1')).toMatchObject({
      type: 'MORTGAGE_REDEMPTION',
      amount: 440,
    });
    const stored = database
      .prepare('SELECT state, redeemed_by_transaction_id AS redeemed FROM mortgages WHERE id = ?')
      .get('m1');
    expect(stored).toEqual({ state: 'REDEEMED', redeemed: 'r1' });
  });

  it('lets the same property be mortgaged again after it was redeemed', async () => {
    await mortgage('m1', 'Boardwalk');
    await redeem('r1', 'm1');
    await mortgage('m2', 'Boardwalk', 'a', 500);

    expect((await mortgages.listActive('game')).map((item) => item.id)).toEqual(['m2']);
  });

  it('rolls back a duplicate active name, leaving balances and history alone', async () => {
    await mortgage('m1', 'Boardwalk');
    const before = balances();

    await expect(mortgage('m2', 'boardwalk')).rejects.toThrow();

    expect(balances()).toEqual(before);
    expect(await transactions.getById('game', 'm2')).toBeNull();
    expect(await mortgages.listActive('game')).toHaveLength(1);
  });

  it('rolls back a second redemption of the same mortgage, so it is never charged twice', async () => {
    await mortgage('m1', 'Boardwalk');
    await redeem('r1', 'm1');
    const before = balances();
    // A competing command prepared before `r1` committed.
    const stale = redeemMortgage({
      game,
      players: players(),
      playerId: 'a',
      mortgage: {
        id: 'm1',
        gameId: 'game',
        playerId: 'a',
        propertyName: 'Boardwalk',
        mortgageValue: 400,
        createdAt: '',
      },
    });

    await expect(persist('r2', stale)).rejects.toThrow();

    expect(balances()).toEqual(before);
    expect(await transactions.getById('game', 'r2')).toBeNull();
  });

  it('keeps mortgages of different players apart', async () => {
    await mortgage('m1', 'Boardwalk', 'a');
    await mortgage('m2', 'Boardwalk', 'b');

    expect((await mortgages.listActive('game')).map((item) => item.playerId)).toEqual(['a', 'b']);
  });

  async function bankrupt(id: string, playerId: string, creditorPlayerId?: string) {
    const result = declareBankruptcy({
      game,
      players: players(),
      playerId,
      ...(creditorPlayerId === undefined ? {} : { creditorPlayerId }),
    });
    await operations.persist({
      transactionId: id,
      transaction: result.transaction,
      balanceChanges: result.affectedPlayers,
      bankruptPlayerId: playerId,
      mortgageHeirPlayerId: creditorPlayerId ?? null,
    });
  }

  it("hands a bankrupt player's mortgages to the creditor, who can then redeem them", async () => {
    await mortgage('m1', 'Boardwalk', 'a');
    await mortgage('m2', 'Park Place', 'a');

    await bankrupt('bankrupt-1', 'a', 'b');

    const active = await mortgages.listActive('game');
    expect(active.map((item) => [item.id, item.playerId])).toEqual([
      ['m1', 'b'],
      ['m2', 'b'],
    ]);
    await expect(redeem('r1', 'm1', 'b')).resolves.toBeUndefined();
    expect((await mortgages.listActive('game')).map((item) => item.id)).toEqual(['m2']);
  });

  it('releases every mortgage of a player who goes bankrupt to the bank', async () => {
    await mortgage('m1', 'Boardwalk', 'a');
    await mortgage('m2', 'Boardwalk', 'b');

    await bankrupt('bankrupt-1', 'a');

    expect((await mortgages.listActive('game')).map((item) => [item.id, item.playerId])).toEqual([
      ['m2', 'b'],
    ]);
    const released = database.prepare('SELECT state FROM mortgages WHERE id = ?').get('m1');
    expect(released).toEqual({ state: 'RELEASED' });
  });

  it('releases a mortgage whose name the creditor already has mortgaged instead of failing', async () => {
    await mortgage('m1', 'Boardwalk', 'a');
    await mortgage('m2', 'boardwalk', 'b');
    await mortgage('m3', 'Park Place', 'a');

    await bankrupt('bankrupt-1', 'a', 'b');

    const active = await mortgages.listActive('game');
    expect(active.map((item) => [item.id, item.playerId])).toEqual([
      ['m2', 'b'],
      ['m3', 'b'],
    ]);
    expect(database.prepare('SELECT state FROM mortgages WHERE id = ?').get('m1')).toEqual({
      state: 'RELEASED',
    });
    expect(
      (database.prepare('SELECT status FROM players WHERE id = ?').get('a') as { status: string })
        .status,
    ).toBe('BANKRUPT');
  });

  it('does not let the bankrupt player or their creditor mortgage a property twice', async () => {
    await mortgage('m1', 'Boardwalk', 'a');
    await bankrupt('bankrupt-1', 'a', 'b');

    await expect(mortgage('m2', 'Boardwalk', 'b')).rejects.toThrow();
    expect(await mortgages.listActive('game')).toHaveLength(1);
  });

  it('cannot be reversed, because it is redeemed instead', async () => {
    await mortgage('m1', 'Boardwalk');
    const original = (await transactions.getById('game', 'm1'))!;
    expect(() => reverseTransaction({ game, players: players(), original })).toThrow();
  });

  it('counts a mortgage as money from the bank and a redemption as money to the bank', async () => {
    await mortgage('m1', 'Boardwalk');
    await redeem('r1', 'm1');

    const summary = await new D1GameStatisticsRepository(d1(database)).calculate(game, players());

    expect(summary.receivedFromBank).toBe(400);
    expect(summary.paidToBank).toBe(440);
  });

  it('still deletes a game, and purges an expired one, that holds mortgages', async () => {
    const games = new D1GameRepository(d1(database));
    await mortgage('m1', 'Boardwalk');
    await mortgage('m2', 'Park Place');
    await redeem('r1', 'm1');

    expect(await games.softDelete('game')).toBe(true);
    database.exec(
      "UPDATE games SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-31 days') WHERE id = 'game'",
    );
    await games.purgeExpiredDeleted();

    for (const table of ['mortgages', 'transactions', 'players'])
      expect(
        (database.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number })
          .total,
      ).toBe(0);
  });
});
