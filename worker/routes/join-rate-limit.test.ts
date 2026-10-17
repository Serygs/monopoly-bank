// @vitest-environment node
import { readdir, readFile } from 'node:fs/promises';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import {
  D1SecurityRateLimitRepository,
  type SecurityRateLimitRepository,
} from '../repositories/security-rate-limit-repository.js';
import { createApiRouter } from './api-router.js';

function fixture() {
  const counts = new Map<string, number>();
  const rateLimits: SecurityRateLimitRepository = {
    async take(bucket, limit) {
      const count = (counts.get(bucket) ?? 0) + 1;
      counts.set(bucket, count);
      return count <= limit;
    },
    async recordFailure(bucket) {
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    },
    async isExceeded(bucket, limit) {
      return (counts.get(bucket) ?? 0) >= limit;
    },
    async cleanup() {},
  };
  const known = { gameId: 'game', passwordHash: null, passwordSalt: null, status: 'LOBBY' };
  const getJoinCredentials = vi.fn(async (code: string) => (code === 'GOOD' ? known : null));
  const router = createApiRouter({
    games: {
      getGame: async () => ({ game: { id: 'game', startingBalance: 1500 }, players: [] }),
    } as never,
    banking: {} as never,
    auth: {
      current: async () => ({ id: 'user', nickname: 'Ada' }),
    } as never,
    access: {
      getJoinCredentials,
      verifyGamePassword: async (password?: string) => password !== 'wrong-pass',
      requireLobbySeat: async () => undefined,
      joinLobby: async () => undefined,
    } as never,
    profileStatistics: {} as never,
    rateLimits,
  });
  return { router, counts, getJoinCredentials };
}

function join(code: string, source = '192.0.2.1', path = '/api/games/join'): Request {
  return new Request(`https://bank.example.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': source },
    body: JSON.stringify({ joinCode: code }),
  });
}

describe('join code failure lockout', () => {
  it('locks one source for one code after repeated failures, with the generic answer', async () => {
    const { router, getJoinCredentials } = fixture();
    for (let attempt = 0; attempt < 5; attempt += 1)
      expect((await router(join('ZZZZ'))).status).toBe(404);
    const locked = await router(join('ZZZZ'));
    expect(locked.status).toBe(429);
    await expect(locked.json()).resolves.toMatchObject({ error: { code: 'RATE_LIMITED' } });
    // The lookup is not even attempted any more.
    expect(getJoinCredentials).toHaveBeenCalledTimes(5);
  });

  it('answers a locked unknown code and a locked real code (wrong password) the same way', async () => {
    const { router } = fixture();
    const attempt = (code: string, source: string) =>
      router(
        new Request('https://bank.example.test/api/games/join', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'cf-connecting-ip': source },
          body: JSON.stringify({ joinCode: code, gameAccessPassword: 'wrong-pass' }),
        }),
      );
    const locked: Array<{ status: number; code: string; message: string }> = [];
    for (const [code, source] of [
      ['ZZZZ', '198.51.100.1'],
      ['GOOD', '198.51.100.2'],
    ] as const) {
      for (let tries = 0; tries < 5; tries += 1)
        expect((await attempt(code, source)).status).toBe(404);
      const response = await attempt(code, source);
      const { error } = (await response.json()) as { error: { code: string; message: string } };
      locked.push({ status: response.status, code: error.code, message: error.message });
    }
    expect(locked[0]).toEqual({ status: 429, code: 'RATE_LIMITED', message: expect.any(String) });
    expect(locked[1]).toEqual(locked[0]);
  });

  it('keeps the lock per source and code: another source or another code still gets through', async () => {
    const { router } = fixture();
    for (let attempt = 0; attempt < 5; attempt += 1) await router(join('ZZZZ'));
    expect((await router(join('ZZZZ'))).status).toBe(429);
    expect((await router(join('ZZZZ', '192.0.2.99'))).status).toBe(404);
    expect((await router(join('YYYY'))).status).toBe(404);
  });

  it('does not count a successful join, and spells the code one way', async () => {
    const { router, counts } = fixture();
    for (let attempt = 0; attempt < 3; attempt += 1)
      expect((await router(join(' good '))).status).toBe(200);
    expect([...counts.keys()].filter((key) => key.startsWith('join-fail'))).toEqual([]);
    for (let attempt = 0; attempt < 5; attempt += 1)
      await router(join(attempt % 2 ? 'zzzz' : ' ZZZZ'));
    expect((await router(join('zZzZ'))).status).toBe(429);
  });

  it('locks the source across codes after many failures, so guessing many codes is slow too', async () => {
    const { router } = fixture();
    for (let attempt = 0; attempt < 30; attempt += 1)
      await router(
        join(`C${String(attempt).padStart(3, '2')}`, '203.0.113.7', '/api/games/join/guest'),
      );
    // The generic per-source join allowance (12 guest joins / 10 min) already ends it earlier.
    expect((await router(join('ABCD', '203.0.113.7', '/api/games/join/guest'))).status).toBe(429);
  });

  it('stores hashes only: neither the code nor the address appears in a bucket key', async () => {
    const { router, counts } = fixture();
    await router(join('ZZZZ'));
    const keys = [...counts.keys()].join(' ');
    expect(keys).toContain('join-fail-pair:');
    expect(keys).not.toMatch(/zzzz|192\.0\.2\.1/iu);
  });

  it('uses a high shared per-code cap so a few sources cannot lock a code for everybody', async () => {
    const { router, counts } = fixture();
    for (let source = 1; source <= 20; source += 1) {
      await router(join('ZZZZ', `192.0.2.${source + 100}`));
    }
    expect((await router(join('ZZZZ', '192.0.2.250'))).status).toBe(404);
    expect([...counts.entries()].find(([key]) => key.startsWith('join-fail-code:'))?.[1]).toBe(21);
  });
});

describe('failure counters in D1', () => {
  it('reads without counting and expires with the window', async () => {
    const database = new DatabaseSync(':memory:');
    const directory = new URL('../../migrations/', import.meta.url);
    for (const name of (await readdir(directory)).filter((n) => n.endsWith('.sql')).sort())
      database.exec(await readFile(new URL(name, directory), 'utf8'));
    const repository = new D1SecurityRateLimitRepository(d1(database));
    expect(await repository.isExceeded('b', 2, 60)).toBe(false);
    await repository.recordFailure('b', 60);
    expect(await repository.isExceeded('b', 2, 60)).toBe(false);
    await repository.recordFailure('b', 60);
    expect(await repository.isExceeded('b', 2, 60)).toBe(true);
    // Reading never adds to the count.
    for (let index = 0; index < 5; index += 1) await repository.isExceeded('b', 2, 60);
    expect(
      (
        database.prepare("SELECT count FROM security_rate_limits WHERE bucket = 'b'").get() as {
          count: number;
        }
      ).count,
    ).toBe(2);
    database.exec(
      "UPDATE security_rate_limits SET window_started_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-61 seconds')",
    );
    expect(await repository.isExceeded('b', 2, 60)).toBe(false);
    await repository.recordFailure('b', 60);
    expect(await repository.isExceeded('b', 2, 60)).toBe(false);
  });
});

/** The slice of D1 the repositories use, backed by a real SQLite database. */
function d1(database: DatabaseSync): D1Database {
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
  // D1 runs a batch as one transaction: either every statement applies or none does.
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
