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
       VALUES (?, 'Jackpot', 1500, 200, 'K', 'ACTIVE', 'FAST')`,
    )
    .run(id);
  database
    .prepare(
      `INSERT INTO players (id, game_id, name, color, balance) VALUES (?, ?, 'a', '#123456', 1500)`,
    )
    .run(`${id}-a`, id);
}

function jackpot(database: DatabaseSync, id = 'game'): number {
  return (
    database.prepare('SELECT jackpot_balance FROM games WHERE id = ?').get(id) as {
      jackpot_balance: number;
    }
  ).jackpot_balance;
}

describe('0025 free parking jackpot migration', () => {
  let database: DatabaseSync;
  beforeEach(async () => {
    database = await migratedDatabase();
    seedGame(database);
  });

  it('starts a new game with an empty pot', () => {
    expect(jackpot(database)).toBe(0);
  });

  it('accepts raising the pot and emptying it again', () => {
    database
      .prepare(`UPDATE games SET jackpot_balance = jackpot_balance + 200 WHERE id = 'game'`)
      .run();
    expect(jackpot(database)).toBe(200);
    database.prepare(`UPDATE games SET jackpot_balance = 0 WHERE id = 'game'`).run();
    expect(jackpot(database)).toBe(0);
  });

  it('rejects a negative pot, including a lost compare-and-set', () => {
    expect(() =>
      database.prepare(`UPDATE games SET jackpot_balance = -1 WHERE id = 'game'`).run(),
    ).toThrow(/CHECK constraint failed/);
    database.prepare(`UPDATE games SET jackpot_balance = 100 WHERE id = 'game'`).run();
    expect(() =>
      database
        .prepare(
          `UPDATE games SET jackpot_balance = CASE WHEN jackpot_balance = ? THEN 0 ELSE -1 END WHERE id = 'game'`,
        )
        .run(50),
    ).toThrow(/CHECK constraint failed/);
    expect(jackpot(database)).toBe(100);
  });

  it('rejects inserting a game with a negative pot', () => {
    expect(() =>
      database
        .prepare(
          `INSERT INTO games (id, name, starting_balance, pass_go_reward, currency, status, payment_mode, jackpot_balance)
           VALUES ('bad', 'Bad', 1500, 200, 'K', 'ACTIVE', 'FAST', -5)`,
        )
        .run(),
    ).toThrow(/CHECK constraint failed/);
  });

  it('deletes a whole game that holds a pot and jackpot transactions', () => {
    database.exec(
      `INSERT INTO transactions (id, game_id, type, amount, total_amount)
         VALUES ('t1', 'game', 'TO_JACKPOT', 100, 100), ('t2', 'game', 'JACKPOT_PAYOUT', 100, 100);
       INSERT INTO transaction_participants (transaction_id, game_id, player_id, balance_delta)
         VALUES ('t1', 'game', 'game-a', -100), ('t2', 'game', 'game-a', 100);
       UPDATE games SET jackpot_balance = 100 WHERE id = 'game'`,
    );

    database.prepare('DELETE FROM games WHERE id = ?').run('game');

    for (const table of ['games', 'players', 'transactions', 'transaction_participants'])
      expect(
        (database.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number })
          .total,
      ).toBe(0);
  });

  it('gives existing games an empty pot when upgrading', async () => {
    const legacy = await migratedDatabase('0025');
    seedGame(legacy);
    legacy.exec(
      `INSERT INTO transactions (id, game_id, type, amount, total_amount)
         VALUES ('t1', 'game', 'PLAYER_TO_BANK', 10, 10)`,
    );
    legacy.exec(
      `BEGIN; ${await readFile(new URL('./0025_free_parking_jackpot.sql', directory), 'utf8')}; COMMIT;`,
    );
    expect(jackpot(legacy)).toBe(0);
    expect(
      (legacy.prepare('SELECT COUNT(*) AS total FROM transactions').get() as { total: number })
        .total,
    ).toBe(1);
    expect(legacy.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});
