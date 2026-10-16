// @vitest-environment node
import { readdir, readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';

const directory = new URL('./', import.meta.url);

async function migratedDatabase(): Promise<DatabaseSync> {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  for (const name of files) database.exec(await readFile(new URL(name, directory), 'utf8'));
  return database;
}

describe('0027 game visibility migration', () => {
  let database: DatabaseSync;
  beforeEach(async () => {
    database = await migratedDatabase();
    database
      .prepare(
        `INSERT INTO games (id, name, starting_balance, pass_go_reward, currency, status, payment_mode)
         VALUES ('game', 'Table', 1500, 200, 'K', 'LOBBY', 'FAST')`,
      )
      .run();
  });

  it('makes a game private by default', () => {
    const row = database.prepare('SELECT is_public FROM games WHERE id = ?').get('game') as {
      is_public: number;
    };
    expect(row.is_public).toBe(0);
  });

  it('rejects a value other than 0 or 1', () => {
    expect(() => database.prepare('UPDATE games SET is_public = 2').run()).toThrow();
  });
});
