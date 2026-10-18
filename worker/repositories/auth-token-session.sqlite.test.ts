// @vitest-environment node
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { DatabaseError } from '../services/errors.js';
import { D1AuthTokenRepository } from './auth-token-repository.js';
import { D1SessionRepository } from './session-repository.js';
import { d1, exec, failingD1, migrated, rows, seedUser } from './test-support/sqlite-d1.test.js';

const future = '2999-01-01T00:00:00.000Z';
const past = '2000-01-01T00:00:00.000Z';

interface TokenRow {
  id: string;
  consumed_at: string | null;
}

describe('D1AuthTokenRepository', () => {
  let database: DatabaseSync;
  let repository: D1AuthTokenRepository;

  const issue = (
    id: string,
    replaceActive?: boolean,
    purpose: 'VERIFY_EMAIL' | 'RESET_PASSWORD' = 'VERIFY_EMAIL',
  ) =>
    repository.issue({
      id,
      userId: 'u1',
      purpose,
      tokenHash: `hash-${id}`,
      expiresAt: future,
      ...(replaceActive === undefined ? {} : { replaceActive }),
    });
  const tokens = () =>
    rows<TokenRow>(database, 'SELECT id, consumed_at FROM auth_email_tokens ORDER BY id');

  beforeEach(async () => {
    database = await migrated();
    repository = new D1AuthTokenRepository(d1(database));
    seedUser(database, 'u1');
  });

  it('issues a first token and keeps a fresh active one when not replacing', async () => {
    expect(await issue('t1')).toBe(true);
    expect(await issue('t2')).toBe(false);
    expect(tokens()).toEqual([{ id: 't1', consumed_at: null }]);
  });

  it('replaces the active token of the same purpose when asked', async () => {
    await issue('t1');
    expect(await issue('t2', true)).toBe(true);
    const stored = tokens();
    expect(stored[0].consumed_at).not.toBeNull();
    expect(stored[1]).toEqual({ id: 't2', consumed_at: null });
  });

  it('does not treat replaceActive false as a replacement', async () => {
    await issue('t1');
    expect(await issue('t2', false)).toBe(false);
  });

  it('keeps tokens of another purpose untouched when replacing', async () => {
    await issue('t1', undefined, 'RESET_PASSWORD');
    expect(await issue('t2', true, 'VERIFY_EMAIL')).toBe(true);
    expect(tokens()).toEqual([
      { id: 't1', consumed_at: null },
      { id: 't2', consumed_at: null },
    ]);
  });

  it('retires an active token older than ten minutes without being asked', async () => {
    await issue('t1');
    exec(database, "UPDATE auth_email_tokens SET created_at = datetime('now', '-11 minutes')");
    expect(await issue('t2')).toBe(true);
    expect(tokens()[0].consumed_at).not.toBeNull();
  });

  it('keeps an active token that is nine minutes old', async () => {
    await issue('t1');
    exec(database, "UPDATE auth_email_tokens SET created_at = datetime('now', '-9 minutes')");
    expect(await issue('t2')).toBe(false);
  });

  it('retires an expired active token without being asked', async () => {
    await issue('t1');
    exec(database, 'UPDATE auth_email_tokens SET expires_at = ?', past);
    expect(await issue('t2')).toBe(true);
  });

  it('reports a unique constraint failure as not issued', async () => {
    const repo = new D1AuthTokenRepository(failingD1(new Error('UNIQUE constraint failed: x')));
    expect(
      await repo.issue({
        id: 'a',
        userId: 'u1',
        purpose: 'VERIFY_EMAIL',
        tokenHash: 'h',
        expiresAt: future,
      }),
    ).toBe(false);
  });

  it('wraps any other failure while issuing', async () => {
    const repo = new D1AuthTokenRepository(failingD1(new Error('disk gone')));
    await expect(
      repo.issue({
        id: 'a',
        userId: 'u1',
        purpose: 'VERIFY_EMAIL',
        tokenHash: 'h',
        expiresAt: future,
      }),
    ).rejects.toMatchObject({ code: 'DATABASE_ERROR', operation: 'issueAuthToken' });
  });

  it('consumes a valid token once and returns its user', async () => {
    await issue('t1');
    expect(await repository.consume('hash-t1', 'VERIFY_EMAIL')).toBe('u1');
    expect(tokens()[0].consumed_at).not.toBeNull();
    expect(await repository.consume('hash-t1', 'VERIFY_EMAIL')).toBeNull();
  });

  it('refuses a token for the wrong purpose, unknown hash or expiry', async () => {
    await issue('t1');
    expect(await repository.consume('hash-t1', 'RESET_PASSWORD')).toBeNull();
    expect(await repository.consume('missing', 'VERIFY_EMAIL')).toBeNull();
    exec(database, 'UPDATE auth_email_tokens SET expires_at = ?', past);
    expect(await repository.consume('hash-t1', 'VERIFY_EMAIL')).toBeNull();
    expect(tokens()[0].consumed_at).toBeNull();
  });

  it('wraps failures while consuming, discarding and cleaning up', async () => {
    const repo = new D1AuthTokenRepository(failingD1(new Error('boom')));
    await expect(repo.consume('h', 'VERIFY_EMAIL')).rejects.toMatchObject({
      operation: 'consumeAuthToken',
    });
    await expect(repo.discard('h')).rejects.toMatchObject({ operation: 'discardAuthToken' });
    await expect(repo.deleteExpired()).rejects.toMatchObject({
      operation: 'deleteExpiredAuthTokens',
    });
    await expect(repo.deleteExpired()).rejects.toBeInstanceOf(DatabaseError);
  });

  it('discards only unconsumed tokens', async () => {
    await issue('t1');
    await repository.discard('hash-t1');
    expect(tokens()).toEqual([]);
    await issue('t2');
    await repository.consume('hash-t2', 'VERIFY_EMAIL');
    await repository.discard('hash-t2');
    expect(tokens()).toHaveLength(1);
  });

  it('deletes expired tokens and consumed ones older than seven days only', async () => {
    seedUser(database, 'u2');
    const insert = (
      id: string,
      userId: string,
      expires: string,
      consumed: string | null,
      purpose = 'VERIFY_EMAIL',
    ) =>
      exec(
        database,
        'INSERT INTO auth_email_tokens (id, user_id, purpose, token_hash, expires_at, consumed_at) VALUES (?, ?, ?, ?, ?, ?)',
        id,
        userId,
        purpose,
        `h-${id}`,
        expires,
        consumed,
      );
    insert('expired', 'u1', past, null);
    insert('active', 'u1', future, null, 'RESET_PASSWORD');
    insert('old-consumed', 'u2', future, '2000-01-01 00:00:00');
    const recent = rows<{ v: string }>(database, "SELECT datetime('now', '-6 days') AS v")[0].v;
    insert('recent-consumed', 'u2', future, recent, 'RESET_PASSWORD');
    await repository.deleteExpired();
    expect(tokens().map((token) => token.id)).toEqual(['active', 'recent-consumed']);
  });
});

describe('D1SessionRepository', () => {
  let database: DatabaseSync;
  let repository: D1SessionRepository;

  beforeEach(async () => {
    database = await migrated();
    repository = new D1SessionRepository(d1(database));
    seedUser(database, 'u1');
    seedUser(database, 'u2');
  });

  it('finds an active session by token hash with its expiry', async () => {
    await repository.create('s1', 'u1', 'tok', future);
    expect(await repository.findActive('tok')).toEqual({ userId: 'u1', expiresAt: future });
    expect(await repository.findActive('other')).toBeNull();
  });

  it('does not find an expired session', async () => {
    await repository.create('s1', 'u1', 'tok', past);
    expect(await repository.findActive('tok')).toBeNull();
  });

  it('extends a lease but never shortens it', async () => {
    await repository.create('s1', 'u1', 'tok', '2900-01-01T00:00:00.000Z');
    expect(await repository.renew('tok', future)).toBe(true);
    expect((await repository.findActive('tok'))?.expiresAt).toBe(future);
    expect(await repository.renew('tok', '2800-01-01T00:00:00.000Z')).toBe(true);
    expect((await repository.findActive('tok'))?.expiresAt).toBe(future);
  });

  it('does not renew an expired or unknown session', async () => {
    await repository.create('s1', 'u1', 'tok', past);
    expect(await repository.renew('tok', future)).toBe(false);
    expect(await repository.renew('missing', future)).toBe(false);
    expect(
      rows<{ expires_at: string }>(database, 'SELECT expires_at FROM user_sessions')[0].expires_at,
    ).toBe(past);
  });

  it('deletes one session, all sessions of a user, and expired ones', async () => {
    await repository.create('s1', 'u1', 'a', future);
    await repository.create('s2', 'u1', 'b', future);
    await repository.create('s3', 'u2', 'c', future);
    await repository.delete('a');
    expect(
      rows<{ id: string }>(database, 'SELECT id FROM user_sessions ORDER BY id').map((r) => r.id),
    ).toEqual(['s2', 's3']);
    await repository.deleteAllForUser('u1');
    expect(rows<{ id: string }>(database, 'SELECT id FROM user_sessions').map((r) => r.id)).toEqual(
      ['s3'],
    );
    await repository.create('s4', 'u2', 'd', past);
    await repository.deleteExpired();
    expect(rows<{ id: string }>(database, 'SELECT id FROM user_sessions').map((r) => r.id)).toEqual(
      ['s3'],
    );
  });
});
