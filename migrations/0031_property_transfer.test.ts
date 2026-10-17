// @vitest-environment node
import { readdir, readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const directory = new URL('./', import.meta.url);
const MIGRATION = '0031_property_transfer.sql';

async function migrate(database: DatabaseSync, only: (name: string) => boolean): Promise<void> {
  const files = (await readdir(directory)).filter((name) => name.endsWith('.sql') && only(name));
  // D1 applies a migration file as one transaction, which is what lets `defer_foreign_keys` last
  // from the DROP to the refill.
  for (const name of files.sort()) {
    database.exec('BEGIN');
    database.exec(await readFile(new URL(name, directory), 'utf8'));
    database.exec('COMMIT');
  }
}

async function database(upTo31 = true): Promise<DatabaseSync> {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  await migrate(db, (name) => (upTo31 ? true : name < MIGRATION));
  return db;
}

function seed(db: DatabaseSync): void {
  db.exec(`
    INSERT INTO games (id, name, starting_balance, pass_go_reward, currency, status, payment_mode)
      VALUES ('game', 'Trade', 1500, 200, 'K', 'ACTIVE', 'FAST');
    INSERT INTO players (id, game_id, name, color, balance) VALUES
      ('a', 'game', 'a', '#111111', 1500), ('b', 'game', 'b', '#222222', 1500);
    INSERT INTO game_properties (game_id, tile_id) VALUES ('game', 'zhitna'), ('game', 'arbat');`);
}

const insert = (db: DatabaseSync, id: string, type: string, amount = 100, initiator?: string) =>
  db
    .prepare(
      `INSERT INTO transactions (id, game_id, type, amount, total_amount, initiator_player_id)
       VALUES (?, 'game', ?, ?, ?, ?)`,
    )
    .run(id, type, amount, amount, initiator ?? null);
const participant = (db: DatabaseSync, tx: string, player: string, delta: number) =>
  db
    .prepare(
      `INSERT INTO transaction_participants (transaction_id, game_id, player_id, balance_delta)
       VALUES (?, 'game', ?, ?)`,
    )
    .run(tx, player, delta);

describe('0031 property transfer migration', () => {
  it('keeps transactions, participants, property changes, mortgages and links through the rebuild', async () => {
    const db = await database(false);
    seed(db);
    db.exec(`
      INSERT INTO transactions (id, game_id, type, amount, total_amount, tile_id, price_overridden)
        VALUES ('buy', 'game', 'PROPERTY_PURCHASE', 600, 600, 'zhitna', 1);
      INSERT INTO transaction_participants (transaction_id, game_id, player_id, balance_delta)
        VALUES ('buy', 'game', 'a', -600);
      INSERT INTO property_changes (transaction_id, game_id, tile_id, before_owner_player_id,
        before_mortgaged, before_houses, after_owner_player_id, after_mortgaged, after_houses)
        VALUES ('buy', 'game', 'zhitna', NULL, 0, 0, 'a', 0, 0);
      INSERT INTO transactions (id, game_id, type, amount, total_amount, tile_id)
        VALUES ('mort', 'game', 'MORTGAGE', 300, 300, 'zhitna');
      INSERT INTO mortgages (id, game_id, player_id, property_name, name_key, mortgage_value, tile_id)
        VALUES ('mort', 'game', 'a', 'Zhitna', 'zhitna', 300, 'zhitna');
      INSERT INTO payment_requests (id, game_id, payer_player_id, recipient_player_id,
        creator_player_id, approver_player_id, amount, state, expires_at, transaction_id)
        VALUES ('req', 'game', 'a', 'b', 'b', 'a', 600, 'ACCEPTED', '2099-01-01T00:00:00.000Z', 'buy');`);
    await migrate(db, (name) => name === MIGRATION);
    expect(
      db.prepare('SELECT id, tile_id, price_overridden FROM transactions ORDER BY id').all(),
    ).toEqual([
      { id: 'buy', tile_id: 'zhitna', price_overridden: 1 },
      { id: 'mort', tile_id: 'zhitna', price_overridden: 0 },
    ]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM transaction_participants').get()).toEqual({
      n: 1,
    });
    expect(
      db.prepare('SELECT tile_id, after_owner_player_id AS o FROM property_changes').all(),
    ).toEqual([{ tile_id: 'zhitna', o: 'a' }]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM mortgages').get()).toEqual({ n: 1 });
    expect(
      db.prepare("SELECT transaction_id FROM payment_requests WHERE id = 'req'").get(),
    ).toEqual({
      transaction_id: 'buy',
    });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('allows a zero-money PROPERTY_TRANSFER with zero-delta participants, and a mirrored reversal', async () => {
    const db = await database();
    seed(db);
    expect(() => insert(db, 'swap', 'PROPERTY_TRANSFER', 0, 'a')).not.toThrow();
    expect(() => participant(db, 'swap', 'a', 0)).not.toThrow();
    expect(() => participant(db, 'swap', 'b', 0)).not.toThrow();
    db.prepare(
      `INSERT INTO transactions (id, game_id, type, amount, total_amount, reverses_transaction_id)
       VALUES ('undo', 'game', 'REVERSAL', 0, 0, 'swap')`,
    ).run();
    expect(() => participant(db, 'undo', 'a', 0)).not.toThrow();
  });

  it('keeps amounts and deltas strict for every other type', async () => {
    const db = await database();
    seed(db);
    expect(() => insert(db, 'z', 'PLAYER_TO_BANK', 0)).toThrow(/CHECK constraint failed/);
    insert(db, 'bank', 'PLAYER_TO_BANK', 10);
    expect(() => participant(db, 'bank', 'a', 0)).toThrow(/balance_delta/);
    expect(() => participant(db, 'bank', 'a', -10)).not.toThrow();
  });

  it('accepts the initiator only on a transfer and drops PROPERTY_TRADE', async () => {
    const db = await database();
    seed(db);
    expect(() => insert(db, 'x', 'PLAYER_TO_BANK', 10, 'a')).toThrow(/CHECK constraint failed/);
    expect(() => insert(db, 'y', 'PROPERTY_TRANSFER', 10, 'a')).not.toThrow();
    expect(() => insert(db, 'g', 'PROPERTY_TRANSFER', 10, 'ghost')).toThrow(/FOREIGN KEY/);
    expect(() => insert(db, 't', 'PROPERTY_TRADE', 10)).toThrow(/CHECK constraint failed/);
  });
});
