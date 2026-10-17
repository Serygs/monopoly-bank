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

function insert(database: DatabaseSync, id: string, type: string, overridden?: number): void {
  database
    .prepare(
      `INSERT INTO transactions (id, game_id, type, amount, total_amount, price_overridden)
       VALUES (?, 'game', ?, 100, 100, ?)`,
    )
    .run(id, type, overridden ?? 0);
}

describe('0030 price override migration', () => {
  let database: DatabaseSync;
  beforeEach(async () => {
    database = await migratedDatabase();
    database
      .prepare(
        `INSERT INTO games (id, name, starting_balance, pass_go_reward, currency, status, payment_mode)
         VALUES ('game', 'Props', 1500, 200, 'K', 'ACTIVE', 'FAST')`,
      )
      .run();
  });

  it('defaults to not overridden', () => {
    insert(database, 't1', 'PLAYER_TO_BANK');
    expect(database.prepare('SELECT price_overridden AS p FROM transactions').get()).toEqual({
      p: 0,
    });
  });

  it('allows the flag only on a PROPERTY_PURCHASE', () => {
    expect(() => insert(database, 't1', 'PROPERTY_PURCHASE', 1)).not.toThrow();
    expect(() => insert(database, 't2', 'PLAYER_TO_BANK', 1)).toThrow(/CHECK constraint failed/);
    expect(() => insert(database, 't3', 'PROPERTY_PURCHASE', 2)).toThrow(/CHECK constraint failed/);
  });
});
