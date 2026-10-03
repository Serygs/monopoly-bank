import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { D1SessionRepository } from './session-repository.js';
import { D1UserRepository } from './user-repository.js';

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  databases.push(sqlite);
  const migrations = new URL('../../migrations/', import.meta.url);
  for (const name of readdirSync(migrations)
    .filter((name) => name.endsWith('.sql'))
    .sort())
    sqlite.exec(readFileSync(new URL(name, migrations), 'utf8'));
  const database = {
    prepare(query: string) {
      const statement = sqlite.prepare(query);
      let values: SQLInputValue[] = [];
      return {
        bind(...parameters: SQLInputValue[]) {
          values = parameters;
          return this;
        },
        async first() {
          return statement.get(...values) ?? null;
        },
        async all() {
          return { results: statement.all(...values) };
        },
        async run() {
          return statement.run(...values);
        },
      };
    },
  } as unknown as D1Database;
  function user(id: string, nickname: string, accountType = 'REGISTERED') {
    sqlite
      .prepare(
        'INSERT INTO users (id,nickname,avatar,password_hash,password_salt,account_type) VALUES (?,?,?,?,?,?)',
      )
      .run(id, nickname, '🎩', 'hash', 'salt', accountType);
  }
  return {
    sqlite,
    user,
    users: new D1UserRepository(database),
    sessions: new D1SessionRepository(database),
  };
}

describe('persisted authentication', () => {
  it('renews only active sessions and never shortens an existing lease', async () => {
    const { user, sessions } = fixture();
    user('player', 'Ada');
    const soon = new Date(Date.now() + 60 * 1000).toISOString();
    const later = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    await sessions.create('active', 'player', 'active-hash', soon);
    await expect(sessions.renew('active-hash', later)).resolves.toBe(true);
    await expect(sessions.renew('active-hash', soon)).resolves.toBe(true);
    await expect(sessions.findActive('active-hash')).resolves.toEqual({
      userId: 'player',
      expiresAt: later,
    });
    await sessions.delete('active-hash');
    await expect(sessions.renew('active-hash', later)).resolves.toBe(false);
    await sessions.create('expired', 'player', 'expired-hash', '2000-01-01T00:00:00.000Z');
    await expect(sessions.renew('expired-hash', later)).resolves.toBe(false);
  });

  it('accepts Bsenkiv for the unique registered bsenkiv account without renaming it', async () => {
    const { user, users } = fixture();
    user('player', 'bsenkiv');
    await expect(users.findByLoginNickname('Bsenkiv')).resolves.toMatchObject({
      id: 'player',
      nickname: 'bsenkiv',
    });
    await expect(users.findByNickname('Bsenkiv')).resolves.toBeNull();
  });

  it('preserves exact identities and rejects an ambiguous case-insensitive match', async () => {
    const { user, users } = fixture();
    user('lower', 'bsenkiv');
    user('upper', 'Bsenkiv');
    await expect(users.findByLoginNickname('bsenkiv')).resolves.toMatchObject({ id: 'lower' });
    await expect(users.findByLoginNickname('Bsenkiv')).resolves.toMatchObject({ id: 'upper' });
    await expect(users.findByLoginNickname('BSENKIV')).resolves.toBeNull();
  });

  it('does not fall back to a guest or unknown account', async () => {
    const { user, users } = fixture();
    user('guest', 'bsenkiv', 'GUEST');
    await expect(users.findByLoginNickname('Bsenkiv')).resolves.toBeNull();
    await expect(users.findByLoginNickname('Unknown')).resolves.toBeNull();
  });

  it('keeps valid sessions during cleanup and removes only expired sessions', async () => {
    const { user, sessions } = fixture();
    user('player', 'Ada');
    await sessions.create('valid', 'player', 'valid-hash', '2999-01-01T00:00:00.000Z');
    await sessions.create('expired', 'player', 'expired-hash', '2000-01-01T00:00:00.000Z');
    await expect(sessions.findActive('expired-hash')).resolves.toBeNull();
    await sessions.deleteExpired();
    await expect(sessions.findActive('valid-hash')).resolves.toMatchObject({ userId: 'player' });
    await expect(sessions.findActive('expired-hash')).resolves.toBeNull();
    await sessions.delete('valid-hash');
    await expect(sessions.findActive('valid-hash')).resolves.toBeNull();
  });
});
