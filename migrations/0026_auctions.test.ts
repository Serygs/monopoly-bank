// @vitest-environment node
import { readdir, readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';

const directory = new URL('./', import.meta.url);

async function migratedDatabase(before?: string): Promise<DatabaseSync> {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  const files = (await readdir(directory))
    .filter((name) => name.endsWith('.sql') && (before === undefined || name < before))
    .sort();
  for (const name of files) database.exec(await readFile(new URL(name, directory), 'utf8'));
  return database;
}

function seedGame(database: DatabaseSync, id: string): void {
  database
    .prepare(
      `INSERT INTO games (id, name, starting_balance, pass_go_reward, currency, status, payment_mode)
       VALUES (?, 'Auction', 1500, 200, 'K', 'ACTIVE', 'FAST')`,
    )
    .run(id);
  for (const suffix of ['a', 'b'])
    database
      .prepare(
        `INSERT INTO players (id, game_id, name, color, balance) VALUES (?, ?, ?, '#123456', 1500)`,
      )
      .run(`${id}-${suffix}`, id, suffix);
}

function insertAuction(
  database: DatabaseSync,
  values: {
    id: string;
    game?: string;
    lot?: string;
    initiator?: string;
    state?: string;
    bid?: number;
    bidder?: string | null;
    version?: number;
    settled?: string | null;
  },
): void {
  const game = values.game ?? 'game';
  database
    .prepare(
      `INSERT INTO auctions (id, game_id, lot_name, initiator_player_id, state, current_bid,
         current_bidder_id, version, started_at, ends_at, settled_transaction_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:30.000Z', ?)`,
    )
    .run(
      values.id,
      game,
      values.lot ?? 'Park Lane',
      values.initiator ?? `${game}-a`,
      values.state ?? 'ACTIVE',
      values.bid ?? 0,
      values.bidder ?? null,
      values.version ?? 1,
      values.settled ?? null,
    );
}

function insertPayment(database: DatabaseSync, id: string, game = 'game'): void {
  database
    .prepare(
      `INSERT INTO transactions (id, game_id, type, amount, total_amount, comment)
       VALUES (?, ?, 'AUCTION_PAYMENT', 100, 100, 'Park Lane')`,
    )
    .run(id, game);
  database
    .prepare(
      `INSERT INTO transaction_participants (transaction_id, game_id, player_id, balance_delta)
       VALUES (?, ?, ?, -100)`,
    )
    .run(id, game, `${game}-b`);
}

function count(database: DatabaseSync, table: string): number {
  return (database.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number })
    .total;
}

describe('0026 auctions migration', () => {
  let database: DatabaseSync;
  beforeEach(async () => {
    database = await migratedDatabase();
    seedGame(database, 'game');
    seedGame(database, 'other');
  });

  it('accepts an open auction with no bids and one with a leader', () => {
    insertAuction(database, { id: 'a1' });
    database
      .prepare(`UPDATE auctions SET current_bid = 5, current_bidder_id = 'game-b' WHERE id = 'a1'`)
      .run();
    const row = database.prepare(`SELECT version, state FROM auctions WHERE id = 'a1'`).get() as {
      version: number;
      state: string;
    };
    expect(row).toMatchObject({ version: 1, state: 'ACTIVE' });
  });

  it('rejects bad lot names, states, bids and versions', () => {
    expect(() => insertAuction(database, { id: 'x', lot: '' })).toThrow(/CHECK constraint failed/);
    expect(() => insertAuction(database, { id: 'x', lot: 'a'.repeat(61) })).toThrow(
      /CHECK constraint failed/,
    );
    expect(() => insertAuction(database, { id: 'x', state: 'DONE' })).toThrow(
      /CHECK constraint failed/,
    );
    expect(() => insertAuction(database, { id: 'x', bid: -1 })).toThrow(/CHECK constraint failed/);
    expect(() => insertAuction(database, { id: 'x', version: 0 })).toThrow(
      /CHECK constraint failed/,
    );
  });

  it('requires a bid above zero for a leader but allows a withdrawn bidder to keep the floor', () => {
    expect(() => insertAuction(database, { id: 'x', bid: 0, bidder: 'game-b' })).toThrow(
      /CHECK constraint failed/,
    );
    insertAuction(database, { id: 'a1', bid: 5, bidder: 'game-b' });
    database
      .prepare(
        `UPDATE auctions SET current_bidder_id = NULL, version = version + 1 WHERE id = 'a1'`,
      )
      .run();
    expect(
      database.prepare(`SELECT current_bid FROM auctions WHERE id = 'a1'`).get(),
    ).toMatchObject({ current_bid: 5 });
  });

  it('allows one ACTIVE auction per game but any number of closed ones', () => {
    insertAuction(database, { id: 'a1' });
    expect(() => insertAuction(database, { id: 'a2' })).toThrow(/UNIQUE constraint failed/);
    insertAuction(database, { id: 'o1', game: 'other' });

    database.prepare(`UPDATE auctions SET state = 'NO_SALE' WHERE id = 'a1'`).run();
    insertAuction(database, { id: 'a2' });
    insertPayment(database, 't1');
    database
      .prepare(
        `UPDATE auctions SET state = 'SOLD', current_bid = 100, current_bidder_id = 'game-b',
           settled_transaction_id = 't1' WHERE id = 'a2'`,
      )
      .run();
    insertAuction(database, { id: 'a3' });
    expect(count(database, 'auctions')).toBe(4);
  });

  it('ties SOLD to a settling transaction in both directions', () => {
    insertPayment(database, 't1');
    expect(() =>
      insertAuction(database, { id: 'x', state: 'SOLD', bid: 100, bidder: 'game-b' }),
    ).toThrow(/CHECK constraint failed/);
    expect(() => insertAuction(database, { id: 'x', state: 'NO_SALE', settled: 't1' })).toThrow(
      /CHECK constraint failed/,
    );
    expect(() => insertAuction(database, { id: 'x', state: 'ACTIVE', settled: 't1' })).toThrow(
      /CHECK constraint failed/,
    );
    insertAuction(database, {
      id: 'a1',
      state: 'SOLD',
      bid: 100,
      bidder: 'game-b',
      settled: 't1',
    });
    insertPayment(database, 't2');
    expect(() =>
      insertAuction(database, {
        id: 'a2',
        state: 'SOLD',
        bid: 100,
        bidder: 'game-b',
        settled: 't1',
      }),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it('rejects a lost compare-and-set written as a CHECK trick', () => {
    insertAuction(database, { id: 'a1', bid: 5, bidder: 'game-b', version: 2 });
    expect(() =>
      database
        .prepare(
          `UPDATE auctions SET current_bid = 10, version = CASE WHEN version = ? THEN version + 1 ELSE 0 END
           WHERE id = 'a1'`,
        )
        .run(1),
    ).toThrow(/CHECK constraint failed/);
    expect(database.prepare(`SELECT version FROM auctions WHERE id = 'a1'`).get()).toMatchObject({
      version: 2,
    });
  });

  it('keeps players, bidders and settling transactions inside their own game', () => {
    expect(() => insertAuction(database, { id: 'x', initiator: 'other-a' })).toThrow(
      /FOREIGN KEY constraint failed/,
    );
    expect(() => insertAuction(database, { id: 'x', bid: 5, bidder: 'other-b' })).toThrow(
      /FOREIGN KEY constraint failed/,
    );
    insertPayment(database, 'foreign', 'other');
    expect(() =>
      insertAuction(database, {
        id: 'x',
        state: 'SOLD',
        bid: 100,
        bidder: 'game-b',
        settled: 'foreign',
      }),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it('refuses to delete a player who is the initiator or the leader', () => {
    insertAuction(database, { id: 'a1', bid: 5, bidder: 'game-b' });
    expect(() => database.prepare(`DELETE FROM players WHERE id = 'game-a'`).run()).toThrow(
      /FOREIGN KEY constraint failed/,
    );
    expect(() => database.prepare(`DELETE FROM players WHERE id = 'game-b'`).run()).toThrow(
      /FOREIGN KEY constraint failed/,
    );
  });

  it('deletes a whole game that holds an auction and its settled transaction', () => {
    insertPayment(database, 't1');
    insertAuction(database, { id: 'a1', state: 'SOLD', bid: 100, bidder: 'game-b', settled: 't1' });
    insertAuction(database, { id: 'a2' });

    database.prepare('DELETE FROM games WHERE id = ?').run('game');

    for (const table of ['auctions', 'transactions', 'transaction_participants'])
      expect(count(database, table)).toBe(0);
    expect(count(database, 'games')).toBe(1);
  });

  it('adds the table without touching existing games or transactions when upgrading', async () => {
    const legacy = await migratedDatabase('0026');
    seedGame(legacy, 'game');
    legacy.exec(
      `INSERT INTO transactions (id, game_id, type, amount, total_amount)
         VALUES ('t1', 'game', 'PLAYER_TO_BANK', 10, 10)`,
    );
    legacy.exec(
      `BEGIN; ${await readFile(new URL('./0026_auctions.sql', directory), 'utf8')}; COMMIT;`,
    );
    expect(count(legacy, 'auctions')).toBe(0);
    expect(count(legacy, 'transactions')).toBe(1);
    expect(legacy.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});
