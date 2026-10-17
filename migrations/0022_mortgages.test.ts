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
       VALUES (?, 'Mortgages', 1500, 200, 'K', 'ACTIVE', 'FAST')`,
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

function mortgage(
  database: DatabaseSync,
  id: string,
  options: { name?: string; key?: string; player?: string; value?: number; gameId?: string } = {},
): void {
  const gameId = options.gameId ?? 'game';
  const name = options.name ?? 'Boardwalk';
  transaction(database, id, 'MORTGAGE', gameId);
  database
    .prepare(
      `INSERT INTO mortgages (id, game_id, player_id, property_name, name_key, mortgage_value)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      gameId,
      options.player ?? `${gameId}-a`,
      name,
      options.key ?? name.toLowerCase(),
      options.value ?? 100,
    );
}

describe('0022 mortgages migration', () => {
  let database: DatabaseSync;
  beforeEach(async () => {
    database = await migratedDatabase();
    seedGame(database);
  });

  it.each([
    'MORTGAGE',
    'MORTGAGE_REDEMPTION',
    'LOAN_ISSUE',
    'LOAN_REPAYMENT',
    'TO_JACKPOT',
    'JACKPOT_PAYOUT',
    'AUCTION_PAYMENT',
  ])('accepts the transaction type %s', (type) => {
    expect(() => transaction(database, `t-${type}`, type)).not.toThrow();
  });

  it('still rejects an unknown transaction type', () => {
    expect(() => transaction(database, 'bad', 'GIFT')).toThrow(/CHECK constraint failed/);
  });

  it('stores a mortgage that links to the transaction that created it', () => {
    mortgage(database, 'm1');
    const row = database.prepare('SELECT * FROM mortgages WHERE id = ?').get('m1') as Record<
      string,
      unknown
    >;
    expect(row).toMatchObject({
      property_name: 'Boardwalk',
      mortgage_value: 100,
      state: 'ACTIVE',
      redeemed_by_transaction_id: null,
    });
  });

  it('rejects an empty or over-long name and a non-positive value', () => {
    expect(() => mortgage(database, 'empty', { name: '' })).toThrow(/CHECK constraint failed/);
    expect(() => mortgage(database, 'long', { name: 'x'.repeat(61) })).toThrow(
      /CHECK constraint failed/,
    );
    expect(() => mortgage(database, 'free', { value: 0 })).toThrow(/CHECK constraint failed/);
  });

  it('allows one active mortgage per player and name, ignoring case', () => {
    mortgage(database, 'm1', { name: 'Boardwalk' });
    expect(() => mortgage(database, 'm2', { name: 'boardwalk' })).toThrow(
      /UNIQUE constraint failed/,
    );
    expect(() => mortgage(database, 'm3', { name: 'Boardwalk', player: 'game-b' })).not.toThrow();
  });

  it('compares names by the application key, so non-ASCII case differences still collide', () => {
    mortgage(database, 'm1', { name: 'Київ', key: 'київ' });
    expect(() => mortgage(database, 'm2', { name: 'КИЇВ', key: 'київ' })).toThrow(
      /UNIQUE constraint failed/,
    );
  });

  it('requires a key and only knows the active, redeemed and released states', () => {
    mortgage(database, 'm1');
    expect(() =>
      database
        .prepare(
          `INSERT INTO mortgages (id, game_id, player_id, property_name, name_key, mortgage_value)
           VALUES ('m1', 'game', 'game-a', 'X', '', 10)`,
        )
        .run(),
    ).toThrow(/CHECK constraint failed|UNIQUE constraint failed/);
    expect(() =>
      database.prepare(`UPDATE mortgages SET state = 'GONE' WHERE id = 'm1'`).run(),
    ).toThrow(/CHECK constraint failed/);
    database.prepare(`UPDATE mortgages SET state = 'RELEASED' WHERE id = 'm1'`).run();
    // A released mortgage no longer blocks the same name.
    expect(() => mortgage(database, 'm2')).not.toThrow();
  });

  it('allows the same name again once it was redeemed', () => {
    mortgage(database, 'm1');
    transaction(database, 'r1', 'MORTGAGE_REDEMPTION');
    database
      .prepare(
        `UPDATE mortgages SET state = 'REDEEMED', redeemed_by_transaction_id = 'r1' WHERE id = 'm1'`,
      )
      .run();
    expect(() => mortgage(database, 'm2')).not.toThrow();
  });

  it('keeps the redeemed state and its transaction in step, and redeems once', () => {
    mortgage(database, 'm1');
    mortgage(database, 'm2', { name: 'Park Place' });
    transaction(database, 'r1', 'MORTGAGE_REDEMPTION');
    expect(() =>
      database.prepare(`UPDATE mortgages SET state = 'REDEEMED' WHERE id = 'm1'`).run(),
    ).toThrow(/CHECK constraint failed/);
    expect(() =>
      database
        .prepare(`UPDATE mortgages SET redeemed_by_transaction_id = 'r1' WHERE id = 'm1'`)
        .run(),
    ).toThrow(/CHECK constraint failed/);
    database
      .prepare(
        `UPDATE mortgages SET state = 'REDEEMED', redeemed_by_transaction_id = 'r1' WHERE id = 'm1'`,
      )
      .run();
    expect(() =>
      database
        .prepare(
          `UPDATE mortgages SET state = 'REDEEMED', redeemed_by_transaction_id = 'r1' WHERE id = 'm2'`,
        )
        .run(),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it('rejects a mortgage for a player or transaction of another game', () => {
    seedGame(database, 'other');
    transaction(database, 'foreign', 'MORTGAGE', 'other');
    expect(() =>
      database
        .prepare(
          `INSERT INTO mortgages (id, game_id, player_id, property_name, name_key, mortgage_value)
           VALUES ('foreign', 'game', 'game-a', 'Boardwalk', 'boardwalk', 100)`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/);
    expect(() => mortgage(database, 'cross', { player: 'other-a' })).toThrow(
      /FOREIGN KEY constraint failed/,
    );
  });

  it('deletes a whole game that holds a mortgage, a reversal and an accepted payment request', () => {
    mortgage(database, 'm1');
    transaction(database, 'original', 'PLAYER_TO_PLAYER');
    database
      .prepare(
        `INSERT INTO transactions (id, game_id, type, amount, total_amount, reverses_transaction_id)
         VALUES ('reversal', 'game', 'REVERSAL', 100, 100, 'original')`,
      )
      .run();
    database.exec(
      `INSERT INTO payment_requests (id, game_id, payer_player_id, recipient_player_id, creator_player_id, approver_player_id, amount, state, expires_at, transaction_id)
       VALUES ('p1', 'game', 'game-a', 'game-b', 'game-b', 'game-a', 100, 'ACCEPTED', '2099-01-01T00:00:00.000Z', 'original')`,
    );

    database.prepare('DELETE FROM games WHERE id = ?').run('game');

    for (const table of ['transactions', 'mortgages', 'payment_requests'])
      expect(
        (database.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number })
          .total,
      ).toBe(0);
  });

  it('keeps every transaction, reversal link, participant and payment request when upgrading', async () => {
    const legacy = await migratedDatabase('0022');
    seedGame(legacy);
    legacy.exec(
      `INSERT INTO transactions (id, game_id, type, amount, total_amount, comment)
         VALUES ('t1', 'game', 'PLAYER_TO_PLAYER', 10, 10, 'rent');
       INSERT INTO transactions (id, game_id, type, amount, total_amount, reverses_transaction_id)
         VALUES ('t2', 'game', 'REVERSAL', 10, 10, 't1');
       INSERT INTO transaction_participants (transaction_id, game_id, player_id, balance_delta)
         VALUES ('t1', 'game', 'game-a', -10), ('t1', 'game', 'game-b', 10),
                ('t2', 'game', 'game-a', 10), ('t2', 'game', 'game-b', -10);
       INSERT INTO payment_requests (id, game_id, payer_player_id, recipient_player_id, creator_player_id, approver_player_id, amount, state, expires_at, transaction_id)
         VALUES ('r1', 'game', 'game-a', 'game-b', 'game-b', 'game-a', 10, 'ACCEPTED', '2099-01-01T00:00:00.000Z', 't1')`,
    );

    // A D1 migration runs as one transaction, which is what lets the foreign-key check wait.
    legacy.exec(
      `BEGIN; ${await readFile(new URL('./0022_mortgages.sql', directory), 'utf8')}; COMMIT;`,
    );

    expect(
      legacy
        .prepare(
          'SELECT id, comment, reverses_transaction_id AS reverses FROM transactions ORDER BY id',
        )
        .all(),
    ).toEqual([
      { id: 't1', comment: 'rent', reverses: null },
      { id: 't2', comment: null, reverses: 't1' },
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
    expect(legacy.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});
