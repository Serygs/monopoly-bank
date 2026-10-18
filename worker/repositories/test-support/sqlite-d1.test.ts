import { readdir, readFile } from 'node:fs/promises';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

export type SqlValue = SQLInputValue;

export function d1(database: DatabaseSync): D1Database {
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

export function failingD1(cause: Error): D1Database {
  const statement = {
    bind: () => statement,
    first: async () => {
      throw cause;
    },
    all: async () => {
      throw cause;
    },
    run: async () => {
      throw cause;
    },
  };
  return {
    prepare: () => statement,
    batch: async () => {
      throw cause;
    },
  } as unknown as D1Database;
}

export async function migrated(): Promise<DatabaseSync> {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  const directory = new URL('../../../migrations/', import.meta.url);
  const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  for (const name of files) database.exec(await readFile(new URL(name, directory), 'utf8'));
  return database;
}

export function exec(database: DatabaseSync, sql: string, ...values: SQLInputValue[]): void {
  database.prepare(sql).run(...values);
}

export function rows<T>(database: DatabaseSync, sql: string, ...values: SQLInputValue[]): T[] {
  return database.prepare(sql).all(...values) as T[];
}

export function seedUser(
  database: DatabaseSync,
  id: string,
  options: { accountType?: 'REGISTERED' | 'GUEST'; email?: string | null } = {},
): void {
  const email = options.email ?? null;
  exec(
    database,
    'INSERT INTO users (id, nickname, avatar, password_hash, password_salt, account_type, email, normalized_email) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id,
    `nick-${id}`,
    'av',
    'hash',
    'salt',
    options.accountType ?? 'REGISTERED',
    email,
    email === null ? null : email.toLowerCase(),
  );
}

export function seedGame(
  database: DatabaseSync,
  id: string,
  options: { owner?: string | null; status?: string; joinCode?: string | null } = {},
): void {
  exec(
    database,
    'INSERT INTO games (id, name, starting_balance, pass_go_reward, owner_user_id, join_code, status) VALUES (?, ?, 1500, 200, ?, ?, ?)',
    id,
    `game-${id}`,
    options.owner ?? null,
    options.joinCode ?? null,
    options.status ?? 'ACTIVE',
  );
}

export function seedPlayer(
  database: DatabaseSync,
  id: string,
  gameId: string,
  balance = 1500,
): void {
  exec(
    database,
    'INSERT INTO players (id, game_id, name, color, balance) VALUES (?, ?, ?, ?, ?)',
    id,
    gameId,
    `p-${id}`,
    '#fff',
    balance,
  );
}

describe('sqlite D1 test harness', () => {
  it('applies every migration and exposes rows through the D1 surface', async () => {
    const database = await migrated();
    seedUser(database, 'u1');
    const first = await d1(database)
      .prepare('SELECT id FROM users WHERE id = ?')
      .bind('u1')
      .first<{ id: string }>();
    expect(first).toEqual({ id: 'u1' });
    const none = await d1(database)
      .prepare('SELECT id FROM users WHERE id = ?')
      .bind('none')
      .first();
    expect(none).toBeNull();
  });

  it('rolls a failed batch back as D1 does', async () => {
    const database = await migrated();
    const db = d1(database);
    await expect(
      db.batch([
        db
          .prepare(
            'INSERT INTO users (id, nickname, avatar, password_hash, password_salt) VALUES (?, ?, ?, ?, ?)',
          )
          .bind('u1', 'n', 'a', 'h', 's'),
        db
          .prepare(
            'INSERT INTO users (id, nickname, avatar, password_hash, password_salt) VALUES (?, ?, ?, ?, ?)',
          )
          .bind('u1', 'n2', 'a', 'h', 's'),
      ]),
    ).rejects.toThrow();
    expect(rows(database, 'SELECT id FROM users')).toEqual([]);
  });

  it('fails every operation of a failing database with the given cause', async () => {
    const cause = new Error('boom');
    const db = failingD1(cause);
    await expect(db.prepare('x').bind().first()).rejects.toBe(cause);
    await expect(db.prepare('x').bind().all()).rejects.toBe(cause);
    await expect(db.prepare('x').bind().run()).rejects.toBe(cause);
    await expect(db.batch([])).rejects.toBe(cause);
  });
});
