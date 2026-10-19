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

describe('0034 games recent amounts migration', () => {
  let database: DatabaseSync;
  const setRecent = (value: string | null) =>
    database.prepare("UPDATE games SET recent_amounts = ? WHERE id = 'game'").run(value);

  beforeEach(async () => {
    database = await migratedDatabase();
    database
      .prepare(
        `INSERT INTO games (id, name, starting_balance, pass_go_reward, currency, status, payment_mode)
         VALUES ('game', 'Recent', 1500, 200, 'UAH', 'ACTIVE', 'FAST')`,
      )
      .run();
  });

  it('starts empty, so existing games keep reading their old list', () => {
    expect(database.prepare('SELECT recent_amounts FROM games').get()).toEqual({
      recent_amounts: null,
    });
  });

  it('stores a JSON array and nothing else', () => {
    expect(() => setRecent('[500,200]')).not.toThrow();
    expect(() => setRecent('[]')).not.toThrow();
    expect(() => setRecent(null)).not.toThrow();
    expect(() => setRecent('{"a":1}')).toThrow(/CHECK constraint failed/);
    expect(() => setRecent('not json')).toThrow(/CHECK constraint failed/);
  });

  it('does not touch the status trigger or the timestamps', () => {
    const before = database.prepare('SELECT updated_at, status FROM games').get();
    setRecent('[10]');
    expect(database.prepare('SELECT updated_at, status FROM games').get()).toEqual(before);
  });
});
