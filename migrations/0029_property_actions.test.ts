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

function seedGame(database: DatabaseSync, id = 'game'): void {
  database
    .prepare(
      `INSERT INTO games (id, name, starting_balance, pass_go_reward, currency, status, payment_mode)
       VALUES (?, 'Props', 1500, 200, 'K', 'ACTIVE', 'FAST')`,
    )
    .run(id);
  for (const player of ['a', 'b'])
    database
      .prepare(
        `INSERT INTO players (id, game_id, name, color, balance) VALUES (?, ?, ?, '#123456', 1500)`,
      )
      .run(`${id}-${player}`, id, player);
}

function transaction(database: DatabaseSync, id: string, type: string, gameId = 'game'): void {
  database
    .prepare(
      `INSERT INTO transactions (id, game_id, type, amount, total_amount) VALUES (?, ?, ?, 100, 100)`,
    )
    .run(id, gameId, type);
}

function property(database: DatabaseSync, tile: string, gameId = 'game'): void {
  database
    .prepare(`INSERT INTO game_properties (game_id, tile_id) VALUES (?, ?)`)
    .run(gameId, tile);
}

interface ChangeValues {
  tx?: string;
  game?: string;
  tile?: string;
  bm?: number;
  bh?: number;
  am?: number;
  ah?: number;
}

function change(database: DatabaseSync, values: ChangeValues = {}): void {
  database
    .prepare(
      `INSERT INTO property_changes (transaction_id, game_id, tile_id, before_owner_player_id,
         before_mortgaged, before_houses, after_owner_player_id, after_mortgaged, after_houses)
       VALUES (?, ?, ?, NULL, ?, ?, 'game-a', ?, ?)`,
    )
    .run(
      values.tx ?? 't1',
      values.game ?? 'game',
      values.tile ?? 'boardwalk',
      values.bm ?? 0,
      values.bh ?? 0,
      values.am ?? 0,
      values.ah ?? 0,
    );
}

function mortgage(database: DatabaseSync, id: string, tile: string | null): void {
  transaction(database, id, 'MORTGAGE');
  database
    .prepare(
      `INSERT INTO mortgages (id, game_id, player_id, property_name, name_key, mortgage_value, tile_id)
       VALUES (?, 'game', 'game-a', ?, ?, 100, ?)`,
    )
    .run(id, `name-${id}`, `name-${id}`, tile);
}

describe('0029 property actions migration', () => {
  let database: DatabaseSync;
  beforeEach(async () => {
    database = await migratedDatabase();
    seedGame(database);
  });

  it.each([
    'PROPERTY_PURCHASE',
    'PROPERTY_BUILD',
    'PROPERTY_SELL_BUILDING',
    'PROPERTY_TRADE',
    'PLAYER_TO_PLAYER',
    'AUCTION_PAYMENT',
  ])('accepts the transaction type %s', (type) => {
    expect(() => transaction(database, `t-${type}`, type)).not.toThrow();
  });

  it('still rejects an unknown transaction type and keeps the amount checks', () => {
    expect(() => transaction(database, 'bad', 'GIFT')).toThrow(/CHECK constraint failed/);
    expect(() =>
      database
        .prepare(
          `INSERT INTO transactions (id, game_id, type, amount, total_amount)
           VALUES ('z', 'game', 'PROPERTY_PURCHASE', 0, 0)`,
        )
        .run(),
    ).toThrow(/CHECK constraint failed/);
  });

  it('keeps tile_id nullable on transactions', () => {
    transaction(database, 't1', 'PROPERTY_PURCHASE');
    database.prepare(`UPDATE transactions SET tile_id = 'boardwalk' WHERE id = 't1'`).run();
    transaction(database, 't2', 'PLAYER_TO_BANK');
    expect(database.prepare('SELECT id, tile_id FROM transactions ORDER BY id').all()).toEqual([
      { id: 't1', tile_id: 'boardwalk' },
      { id: 't2', tile_id: null },
    ]);
  });

  it('allows one active mortgage per tile, a nullable tile, and frees the tile when released', () => {
    property(database, 'boardwalk');
    mortgage(database, 'm0', null);
    mortgage(database, 'm00', null);
    mortgage(database, 'm1', 'boardwalk');
    expect(() => mortgage(database, 'm2', 'boardwalk')).toThrow(/UNIQUE constraint failed/);
    database.prepare(`UPDATE mortgages SET state = 'RELEASED' WHERE id = 'm1'`).run();
    expect(() => mortgage(database, 'm3', 'boardwalk')).not.toThrow();
  });

  it('adds a nullable tile_id to auctions', () => {
    database
      .prepare(
        `INSERT INTO auctions (id, game_id, lot_name, initiator_player_id, started_at, ends_at, tile_id)
         VALUES ('au1', 'game', 'Lot', 'game-a', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:30.000Z', 'boardwalk')`,
      )
      .run();
    expect(database.prepare(`SELECT tile_id FROM auctions WHERE id = 'au1'`).get()).toEqual({
      tile_id: 'boardwalk',
    });
  });

  it('stores a property change and keys it by transaction and tile', () => {
    property(database, 'boardwalk');
    transaction(database, 't1', 'PROPERTY_PURCHASE');
    expect(() => change(database)).not.toThrow();
    expect(() => change(database)).toThrow(/UNIQUE constraint failed/);
  });

  it('rejects out-of-range mortgage flags and house counts', () => {
    property(database, 'boardwalk');
    transaction(database, 't1', 'PROPERTY_BUILD');
    for (const bad of [{ bm: 2 }, { am: 2 }, { bh: 6 }, { ah: 6 }, { bh: -1 }, { ah: -1 }])
      expect(() => change(database, bad)).toThrow(/CHECK constraint failed/);
  });

  it('rejects a change for a missing transaction, a missing property or another game', () => {
    seedGame(database, 'other');
    property(database, 'boardwalk');
    property(database, 'boardwalk', 'other');
    transaction(database, 't1', 'PROPERTY_PURCHASE');
    expect(() => change(database, { tx: 'nope' })).toThrow(/FOREIGN KEY constraint failed/);
    expect(() => change(database, { tile: 'unknown' })).toThrow(/FOREIGN KEY constraint failed/);
    expect(() => change(database, { game: 'other' })).toThrow(/FOREIGN KEY constraint failed/);
  });

  it('cascades property changes when the game is deleted', () => {
    property(database, 'boardwalk');
    transaction(database, 't1', 'PROPERTY_PURCHASE');
    change(database);
    database.prepare('DELETE FROM games WHERE id = ?').run('game');
    expect(
      (
        database.prepare('SELECT COUNT(*) AS total FROM property_changes').get() as {
          total: number;
        }
      ).total,
    ).toBe(0);
  });

  it('keeps every row and foreign key when upgrading from 0028', async () => {
    const legacy = await migratedDatabase('0029');
    seedGame(legacy);
    legacy.exec(
      `INSERT INTO transactions (id, game_id, type, amount, total_amount, comment)
         VALUES ('t1', 'game', 'PLAYER_TO_PLAYER', 10, 10, 'rent');
       INSERT INTO transactions (id, game_id, type, amount, total_amount, reverses_transaction_id)
         VALUES ('t2', 'game', 'REVERSAL', 10, 10, 't1');
       INSERT INTO transactions (id, game_id, type, amount, total_amount)
         VALUES ('m1', 'game', 'MORTGAGE', 50, 50), ('au-t', 'game', 'AUCTION_PAYMENT', 70, 70);
       INSERT INTO transaction_participants (transaction_id, game_id, player_id, balance_delta)
         VALUES ('t1', 'game', 'game-a', -10), ('t1', 'game', 'game-b', 10),
                ('t2', 'game', 'game-a', 10), ('t2', 'game', 'game-b', -10);
       INSERT INTO payment_requests (id, game_id, payer_player_id, recipient_player_id, creator_player_id, approver_player_id, amount, state, expires_at, transaction_id)
         VALUES ('r1', 'game', 'game-a', 'game-b', 'game-b', 'game-a', 10, 'ACCEPTED', '2099-01-01T00:00:00.000Z', 't1');
       INSERT INTO mortgages (id, game_id, player_id, property_name, name_key, mortgage_value)
         VALUES ('m1', 'game', 'game-a', 'Boardwalk', 'boardwalk', 50);
       INSERT INTO auctions (id, game_id, lot_name, initiator_player_id, state, started_at, ends_at, settled_transaction_id)
         VALUES ('au1', 'game', 'Lot', 'game-a', 'SOLD', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:30.000Z', 'au-t')`,
    );

    // A D1 migration runs as one transaction, which is what lets the foreign-key check wait.
    legacy.exec(
      `BEGIN; ${await readFile(new URL('./0029_property_actions.sql', directory), 'utf8')}; COMMIT;`,
    );

    expect(
      legacy
        .prepare(
          'SELECT id, comment, reverses_transaction_id AS reverses, tile_id FROM transactions ORDER BY id',
        )
        .all(),
    ).toEqual([
      { id: 'au-t', comment: null, reverses: null, tile_id: null },
      { id: 'm1', comment: null, reverses: null, tile_id: null },
      { id: 't1', comment: 'rent', reverses: null, tile_id: null },
      { id: 't2', comment: null, reverses: 't1', tile_id: null },
    ]);
    expect(
      (
        legacy.prepare('SELECT COUNT(*) AS total FROM transaction_participants').get() as {
          total: number;
        }
      ).total,
    ).toBe(4);
    expect(
      legacy.prepare('SELECT transaction_id FROM payment_requests WHERE id = ?').get('r1'),
    ).toEqual({ transaction_id: 't1' });
    expect(legacy.prepare(`SELECT tile_id FROM mortgages WHERE id = 'm1'`).get()).toEqual({
      tile_id: null,
    });
    expect(
      legacy.prepare(`SELECT settled_transaction_id AS s FROM auctions WHERE id = 'au1'`).get(),
    ).toEqual({ s: 'au-t' });
    expect(legacy.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});
