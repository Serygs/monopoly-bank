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
       VALUES (?, 'Reversals', 1500, 200, 'K', 'ACTIVE', 'FAST')`,
    )
    .run(id);
  for (const player of ['a', 'b'])
    database
      .prepare(
        `INSERT INTO players (id, game_id, name, color, balance) VALUES (?, ?, ?, '#123456', 1500)`,
      )
      .run(`${id}-${player}`, id, player);
}

function transaction(
  database: DatabaseSync,
  id: string,
  gameId = 'game',
  type = 'PLAYER_TO_PLAYER',
  reverses: string | null = null,
): void {
  database
    .prepare(
      `INSERT INTO transactions (id, game_id, type, amount, total_amount, reverses_transaction_id)
       VALUES (?, ?, ?, 10, 10, ?)`,
    )
    .run(id, gameId, type, reverses);
}

describe('0021 transaction reversals migration', () => {
  let database: DatabaseSync;
  beforeEach(async () => {
    database = await migratedDatabase();
    seedGame(database);
  });

  it('accepts a reversal that links to an earlier transaction of the same game', () => {
    transaction(database, 'original');
    transaction(database, 'reversal', 'game', 'REVERSAL', 'original');
    const row = database
      .prepare('SELECT reverses_transaction_id AS reverses FROM transactions WHERE id = ?')
      .get('reversal') as { reverses: string };
    expect(row.reverses).toBe('original');
  });

  it('requires a link for a reversal and forbids one on every other type', () => {
    transaction(database, 'original');
    expect(() => transaction(database, 'bare', 'game', 'REVERSAL')).toThrow(
      /CHECK constraint failed/,
    );
    expect(() => transaction(database, 'odd', 'game', 'PLAYER_TO_BANK', 'original')).toThrow(
      /CHECK constraint failed/,
    );
  });

  it('allows a transaction to be reversed only once', () => {
    transaction(database, 'original');
    transaction(database, 'first', 'game', 'REVERSAL', 'original');
    expect(() => transaction(database, 'second', 'game', 'REVERSAL', 'original')).toThrow(
      /UNIQUE constraint failed/,
    );
  });

  it('rejects a reversal of itself, of a missing transaction and of another game', () => {
    expect(() => transaction(database, 'loop', 'game', 'REVERSAL', 'loop')).toThrow(
      /CHECK constraint failed/,
    );
    expect(() => transaction(database, 'ghost', 'game', 'REVERSAL', 'nothing')).toThrow(
      /FOREIGN KEY constraint failed/,
    );
    seedGame(database, 'other');
    transaction(database, 'foreign', 'other');
    expect(() => transaction(database, 'cross', 'game', 'REVERSAL', 'foreign')).toThrow(
      /FOREIGN KEY constraint failed/,
    );
  });

  it('keeps a reversed transaction from being deleted on its own', () => {
    transaction(database, 'original');
    transaction(database, 'reversal', 'game', 'REVERSAL', 'original');
    expect(() => database.prepare('DELETE FROM transactions WHERE id = ?').run('original')).toThrow(
      /FOREIGN KEY constraint failed/,
    );
  });

  it('deletes a whole game that contains a reversal and an accepted payment request', () => {
    transaction(database, 'original');
    transaction(database, 'reversal', 'game', 'REVERSAL', 'original');
    database.exec(
      `INSERT INTO transaction_participants (transaction_id, game_id, player_id, balance_delta)
         VALUES ('original', 'game', 'game-a', -10), ('original', 'game', 'game-b', 10),
                ('reversal', 'game', 'game-a', 10), ('reversal', 'game', 'game-b', -10);
       INSERT INTO payment_requests (id, game_id, payer_player_id, recipient_player_id, creator_player_id, approver_player_id, amount, state, expires_at, transaction_id)
         VALUES ('r1', 'game', 'game-a', 'game-b', 'game-b', 'game-a', 10, 'ACCEPTED', '2099-01-01T00:00:00.000Z', 'original')`,
    );

    database.prepare('DELETE FROM games WHERE id = ?').run('game');

    for (const table of ['transactions', 'transaction_participants', 'payment_requests'])
      expect(
        (database.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number })
          .total,
      ).toBe(0);
  });

  it('keeps every row, participant and payment-request link when upgrading existing data', async () => {
    const legacy = await migratedDatabase('0021');
    seedGame(legacy);
    legacy.exec(
      `INSERT INTO transactions (id, game_id, type, amount, total_amount, comment)
         VALUES ('t1', 'game', 'PLAYER_TO_PLAYER', 10, 10, 'rent'), ('t2', 'game', 'PASS_GO', 200, 200, NULL);
       INSERT INTO transaction_participants (transaction_id, game_id, player_id, balance_delta)
         VALUES ('t1', 'game', 'game-a', -10), ('t1', 'game', 'game-b', 10), ('t2', 'game', 'game-a', 200);
       INSERT INTO payment_requests (id, game_id, payer_player_id, recipient_player_id, creator_player_id, approver_player_id, amount, state, expires_at, transaction_id)
         VALUES ('r1', 'game', 'game-a', 'game-b', 'game-b', 'game-a', 10, 'ACCEPTED', '2099-01-01T00:00:00.000Z', 't1')`,
    );

    // A D1 migration runs as one transaction, which is what lets the foreign-key check wait.
    legacy.exec(
      `BEGIN; ${await readFile(new URL('./0021_transaction_reversals.sql', directory), 'utf8')}; COMMIT;`,
    );

    expect(legacy.prepare('SELECT id, comment FROM transactions ORDER BY id').all()).toEqual([
      { id: 't1', comment: 'rent' },
      { id: 't2', comment: null },
    ]);
    expect(
      legacy.prepare('SELECT COUNT(*) AS total FROM transaction_participants').get() as {
        total: number;
      },
    ).toEqual({ total: 3 });
    expect(
      legacy.prepare('SELECT transaction_id FROM payment_requests WHERE id = ?').get('r1'),
    ).toEqual({ transaction_id: 't1' });
    expect(legacy.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(
      legacy
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'transaction%by%'",
        )
        .all(),
    ).toHaveLength(4);
  });
});
