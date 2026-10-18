// @vitest-environment node
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { ConflictError } from '../services/errors.js';
import { D1CommandLedgerRepository } from './command-ledger-repository.js';
import { D1GameCompletionRepository } from './game-completion-repository.js';
import { D1PrivacyRepository } from './privacy-repository.js';
import { D1SecurityRateLimitRepository } from './security-rate-limit-repository.js';
import {
  d1,
  exec,
  failingD1,
  migrated,
  rows,
  seedGame,
  seedPlayer,
  seedUser,
} from './test-support/sqlite-d1.test.js';

describe('D1SecurityRateLimitRepository', () => {
  let database: DatabaseSync;
  let repository: D1SecurityRateLimitRepository;

  beforeEach(async () => {
    database = await migrated();
    repository = new D1SecurityRateLimitRepository(d1(database));
  });

  it('allows attempts up to the limit and refuses the next one', async () => {
    expect(await repository.take('b', 2, 60)).toBe(true);
    expect(await repository.take('b', 2, 60)).toBe(true);
    expect(await repository.take('b', 2, 60)).toBe(false);
    expect(
      rows<{ count: number }>(database, 'SELECT count FROM security_rate_limits')[0].count,
    ).toBe(3);
  });

  it('counts each bucket separately', async () => {
    await repository.take('a', 1, 60);
    expect(await repository.take('a', 1, 60)).toBe(false);
    expect(await repository.take('b', 1, 60)).toBe(true);
  });

  it('starts a fresh window once the old one has elapsed', async () => {
    exec(
      database,
      "INSERT INTO security_rate_limits (bucket, window_started_at, count) VALUES ('b', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-100 seconds'), 5)",
    );
    expect(await repository.take('b', 1, 60)).toBe(true);
    const [row] = rows<{ count: number; fresh: number }>(
      database,
      "SELECT count, window_started_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 seconds') AS fresh FROM security_rate_limits",
    );
    expect(row).toEqual({ count: 1, fresh: 1 });
  });

  it('keeps the window and count while it is still running', async () => {
    const started = new Date(Date.now() - 30_000).toISOString();
    exec(
      database,
      "INSERT INTO security_rate_limits (bucket, window_started_at, count) VALUES ('b', ?, 5)",
      started,
    );
    expect(await repository.take('b', 10, 60)).toBe(true);
    expect(
      rows<{ count: number; window_started_at: string }>(
        database,
        'SELECT count, window_started_at FROM security_rate_limits',
      )[0],
    ).toEqual({
      count: 6,
      window_started_at: started,
    });
  });

  it('locks out after recorded failures until the window ends, without counting reads', async () => {
    expect(await repository.isExceeded('b', 2, 60)).toBe(false);
    await repository.recordFailure('b', 60);
    expect(await repository.isExceeded('b', 2, 60)).toBe(false);
    await repository.recordFailure('b', 60);
    expect(await repository.isExceeded('b', 2, 60)).toBe(true);
    expect(await repository.isExceeded('b', 2, 60)).toBe(true);
    expect(
      rows<{ count: number }>(database, 'SELECT count FROM security_rate_limits')[0].count,
    ).toBe(2);
    expect(await repository.isExceeded('b', 3, 60)).toBe(false);
  });

  it('ignores failures recorded outside the window', async () => {
    exec(
      database,
      "INSERT INTO security_rate_limits (bucket, window_started_at, count) VALUES ('b', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-100 seconds'), 9)",
    );
    expect(await repository.isExceeded('b', 2, 60)).toBe(false);
    expect(await repository.isExceeded('b', 2, 200)).toBe(true);
  });

  it('removes buckets idle for more than two days only', async () => {
    exec(
      database,
      "INSERT INTO security_rate_limits (bucket, window_started_at, count) VALUES ('old', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 days'), 1)",
    );
    exec(
      database,
      "INSERT INTO security_rate_limits (bucket, window_started_at, count) VALUES ('recent', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 days'), 1)",
    );
    await repository.cleanup();
    expect(
      rows<{ bucket: string }>(database, 'SELECT bucket FROM security_rate_limits').map(
        (r) => r.bucket,
      ),
    ).toEqual(['recent']);
  });

  it('wraps database failures with the operation name', async () => {
    const failing = new D1SecurityRateLimitRepository(failingD1(new Error('boom')));
    await expect(failing.take('b', 1, 1)).rejects.toMatchObject({
      code: 'DATABASE_ERROR',
      operation: 'takeSecurityRateLimit',
    });
    await expect(failing.isExceeded('b', 1, 1)).rejects.toMatchObject({
      operation: 'readSecurityRateLimit',
    });
    await expect(failing.cleanup()).rejects.toMatchObject({
      operation: 'cleanupSecurityRateLimits',
    });
  });
});

describe('D1GameCompletionRepository', () => {
  it('records each participant once and stores the result', async () => {
    const database = await migrated();
    seedUser(database, 'u1');
    seedUser(database, 'u2');
    seedGame(database, 'g1', { owner: 'u1' });
    const repository = new D1GameCompletionRepository(d1(database));
    expect(await repository.record('g1', 'u1', true)).toBe(true);
    expect(await repository.record('g1', 'u1', false)).toBe(false);
    expect(await repository.record('g1', 'u2', false)).toBe(true);
    expect(
      rows(database, 'SELECT user_id, won FROM game_completion_participants ORDER BY user_id'),
    ).toEqual([
      { user_id: 'u1', won: 1 },
      { user_id: 'u2', won: 0 },
    ]);
  });
});

describe('D1CommandLedgerRepository on SQLite', () => {
  let database: DatabaseSync;
  let repository: D1CommandLedgerRepository;
  const input = {
    gameId: 'g1',
    commandId: 'c1',
    actorId: 'a1',
    commandType: 'PAY',
    payloadHash: 'h1',
  };

  beforeEach(async () => {
    database = await migrated();
    seedUser(database, 'u1');
    seedGame(database, 'g1', { owner: 'u1' });
    repository = new D1CommandLedgerRepository(d1(database));
  });

  it('claims a command as pending and replays the same claim', async () => {
    const pending = {
      ...input,
      status: 'PENDING',
      resultStatus: null,
      resultJson: null,
      resultTransactionId: null,
    };
    expect(await repository.claim(input)).toEqual(pending);
    expect(await repository.claim(input)).toEqual(pending);
    expect(rows(database, 'SELECT * FROM command_ledger')).toHaveLength(1);
  });

  it('rejects a reused command ID that differs in actor, type or payload', async () => {
    await repository.claim(input);
    for (const change of [{ actorId: 'a2' }, { commandType: 'OTHER' }, { payloadHash: 'h2' }]) {
      const attempt = repository.claim({ ...input, ...change });
      await expect(attempt).rejects.toBeInstanceOf(ConflictError);
      await expect(attempt).rejects.toMatchObject({ code: 'COMMAND_ID_REUSED', status: 409 });
    }
  });

  it('stores the completed result once and replays it', async () => {
    await repository.claim(input);
    await repository.complete({
      gameId: 'g1',
      commandId: 'c1',
      status: 201,
      result: { ok: true },
      transactionId: 't1',
    });
    await repository.complete({
      gameId: 'g1',
      commandId: 'c1',
      status: 500,
      result: { ok: false },
      transactionId: null,
    });
    expect(await repository.claim(input)).toEqual({
      ...input,
      status: 'COMPLETED',
      resultStatus: 201,
      resultJson: '{"ok":true}',
      resultTransactionId: 't1',
    });
    expect(
      rows<{ completed_at: string | null }>(database, 'SELECT completed_at FROM command_ledger')[0]
        .completed_at,
    ).not.toBeNull();
  });

  it('does not complete another game or command', async () => {
    await repository.claim(input);
    await repository.complete({
      gameId: 'g1',
      commandId: 'other',
      status: 200,
      result: 1,
      transactionId: null,
    });
    expect(rows<{ status: string }>(database, 'SELECT status FROM command_ledger')[0].status).toBe(
      'PENDING',
    );
  });

  it('wraps storage failures without leaking the cause message', async () => {
    const failing = new D1CommandLedgerRepository(failingD1(new Error('secret detail')));
    await expect(failing.claim(input)).rejects.toMatchObject({
      code: 'DATABASE_ERROR',
      operation: 'claimCommand',
      message: 'Internal server error.',
    });
    await expect(
      failing.complete({
        gameId: 'g1',
        commandId: 'c1',
        status: 200,
        result: null,
        transactionId: null,
      }),
    ).rejects.toMatchObject({ code: 'DATABASE_ERROR', operation: 'completeCommand' });
  });

  it('reports a missing row after the insert as a database error', async () => {
    const empty = {
      prepare: () => {
        const statement = {
          bind: () => statement,
          run: async () => ({ meta: { changes: 0 } }),
          first: async () => null,
        };
        return statement;
      },
    } as unknown as D1Database;
    await expect(new D1CommandLedgerRepository(empty).claim(input)).rejects.toMatchObject({
      code: 'DATABASE_ERROR',
      operation: 'claimCommand',
    });
  });
});

describe('D1PrivacyRepository', () => {
  let database: DatabaseSync;
  let repository: D1PrivacyRepository;

  beforeEach(async () => {
    database = await migrated();
    repository = new D1PrivacyRepository(d1(database));
  });

  it('exports the profile and memberships newest game first', async () => {
    seedUser(database, 'u1', { email: 'A@Example.com' });
    exec(database, "UPDATE users SET email_verified_at = '2026-01-01' WHERE id = 'u1'");
    seedGame(database, 'old', { owner: 'u1', status: 'ARCHIVED' });
    seedGame(database, 'new', { owner: 'u1', status: 'LOBBY' });
    exec(database, "UPDATE games SET created_at = '2020-01-01 00:00:00' WHERE id = 'old'");
    exec(database, "UPDATE games SET created_at = '2024-01-01 00:00:00' WHERE id = 'new'");
    seedPlayer(database, 'p1', 'new');
    exec(
      database,
      "INSERT INTO game_members (game_id, user_id, role, player_id) VALUES ('new', 'u1', 'OWNER', 'p1')",
    );
    exec(
      database,
      "INSERT INTO game_members (game_id, user_id, role) VALUES ('old', 'u1', 'PLAYER')",
    );
    const exported = await repository.exportAccount('u1');
    expect(Number.isNaN(Date.parse(exported.exportedAt))).toBe(false);
    expect(exported.profile).toMatchObject({
      id: 'u1',
      nickname: 'nick-u1',
      avatar: 'av',
      accountType: 'REGISTERED',
      email: 'A@Example.com',
      emailVerified: true,
    });
    expect(exported.memberships).toEqual([
      { gameId: 'new', gameName: 'game-new', gameStatus: 'LOBBY', role: 'OWNER', playerId: 'p1' },
      {
        gameId: 'old',
        gameName: 'game-old',
        gameStatus: 'ARCHIVED',
        role: 'PLAYER',
        playerId: null,
      },
    ]);
  });

  it('marks an unverified email and fails for an unknown account', async () => {
    seedUser(database, 'u1', { email: 'a@b.c' });
    expect((await repository.exportAccount('u1')).profile.emailVerified).toBe(false);
    await expect(repository.exportAccount('ghost')).rejects.toThrow('Account does not exist.');
  });

  it('detects memberships in lobby or running games only', async () => {
    seedUser(database, 'u1');
    expect(await repository.hasActiveMembership('u1')).toBe(false);
    seedGame(database, 'done', { owner: 'u1', status: 'ARCHIVED' });
    exec(
      database,
      "INSERT INTO game_members (game_id, user_id, role) VALUES ('done', 'u1', 'OWNER')",
    );
    expect(await repository.hasActiveMembership('u1')).toBe(false);
    for (const status of ['LOBBY', 'ACTIVE']) {
      exec(database, "UPDATE games SET status = ? WHERE id = 'done'", status);
      expect(await repository.hasActiveMembership('u1')).toBe(true);
    }
  });

  it('anonymizes the account, ends its sessions and tokens, and leaves others alone', async () => {
    seedUser(database, 'u1', { email: 'a@b.c' });
    seedUser(database, 'u2', { email: 'x@y.z' });
    for (const user of ['u1', 'u2']) {
      exec(
        database,
        'INSERT INTO user_sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
        `s-${user}`,
        user,
        `t-${user}`,
        '2999-01-01',
      );
      exec(
        database,
        "INSERT INTO auth_email_tokens (id, user_id, purpose, token_hash, expires_at) VALUES (?, ?, 'VERIFY_EMAIL', ?, '2999-01-01')",
        `a-${user}`,
        user,
        `h-${user}`,
      );
    }
    expect(await repository.anonymizeAccount('u1', 'Deleted', 'newhash', 'newsalt')).toBe(true);
    expect(
      rows(
        database,
        "SELECT nickname, avatar, email, normalized_email, email_verified_at, password_hash, password_salt FROM users WHERE id = 'u1'",
      ),
    ).toEqual([
      {
        nickname: 'Deleted',
        avatar: '',
        email: null,
        normalized_email: null,
        email_verified_at: null,
        password_hash: 'newhash',
        password_salt: 'newsalt',
      },
    ]);
    expect(rows(database, "SELECT email FROM users WHERE id = 'u2'")).toEqual([{ email: 'x@y.z' }]);
    expect(rows<{ id: string }>(database, 'SELECT id FROM user_sessions').map((r) => r.id)).toEqual(
      ['s-u2'],
    );
    expect(
      rows<{ id: string }>(database, 'SELECT id FROM auth_email_tokens').map((r) => r.id),
    ).toEqual(['a-u2']);
    expect(await repository.anonymizeAccount('ghost', 'x', 'h', 's')).toBe(false);
  });

  it('removes guests older than thirty days that belong to no game', async () => {
    seedUser(database, 'old-guest', { accountType: 'GUEST' });
    seedUser(database, 'member-guest', { accountType: 'GUEST' });
    seedUser(database, 'new-guest', { accountType: 'GUEST' });
    seedUser(database, 'old-registered');
    seedUser(database, 'owner');
    seedGame(database, 'g1', { owner: 'owner' });
    exec(
      database,
      "INSERT INTO game_members (game_id, user_id, role) VALUES ('g1', 'member-guest', 'PLAYER')",
    );
    exec(
      database,
      "UPDATE users SET created_at = datetime('now', '-31 days') WHERE id IN ('old-guest', 'member-guest', 'old-registered')",
    );
    exec(
      database,
      "UPDATE users SET created_at = datetime('now', '-29 days') WHERE id = 'new-guest'",
    );
    await repository.cleanupExpiredGuests();
    expect(
      rows<{ id: string }>(database, 'SELECT id FROM users ORDER BY id').map((r) => r.id),
    ).toEqual(['member-guest', 'new-guest', 'old-registered', 'owner']);
  });

  it('expires stale requests, purges old resolved data, invitations and ledger entries', async () => {
    seedUser(database, 'u1');
    seedGame(database, 'fin-old', { owner: 'u1', status: 'ARCHIVED' });
    seedGame(database, 'fin-new', { owner: 'u1', status: 'ARCHIVED' });
    seedGame(database, 'live', { owner: 'u1' });
    exec(
      database,
      "UPDATE games SET finished_at = datetime('now', '-91 days') WHERE id = 'fin-old'",
    );
    exec(
      database,
      "UPDATE games SET finished_at = datetime('now', '-89 days') WHERE id = 'fin-new'",
    );
    for (const id of ['live', 'fin-old']) {
      seedPlayer(database, `${id}-a`, id);
      seedPlayer(database, `${id}-b`, id);
    }
    const request = (id: string, state: string, expires: string, resolved: string | null) =>
      exec(
        database,
        "INSERT INTO payment_requests (id, game_id, payer_player_id, recipient_player_id, creator_player_id, approver_player_id, amount, state, expires_at, resolved_at) VALUES (?, 'live', 'live-a', 'live-b', 'live-a', 'live-b', 10, ?, ?, ?)",
        id,
        state,
        expires,
        resolved,
      );
    request('stale', 'PENDING', '2000-01-01T00:00:00.000Z', null);
    request('fresh', 'PENDING', '2999-01-01T00:00:00.000Z', null);
    request('old-done', 'ACCEPTED', '2000-01-01T00:00:00.000Z', '2000-01-01 00:00:00');
    request(
      'new-done',
      'DECLINED',
      '2000-01-01T00:00:00.000Z',
      new Date().toISOString().slice(0, 19).replace('T', ' '),
    );
    const invite = (hash: string, expires: string, revoked: string | null) =>
      exec(
        database,
        "INSERT INTO game_invitations (token_hash, game_id, created_by_user_id, expires_at, revoked_at) VALUES (?, 'live', 'u1', ?, ?)",
        hash,
        expires,
        revoked,
      );
    invite('inv-old', '2000-01-01 00:00:00', null);
    invite('inv-revoked-old', '2999-01-01 00:00:00', '2000-01-01 00:00:00');
    invite('inv-live', '2999-01-01 00:00:00', null);
    await repository.cleanupExpiredOperationalData();
    const states = Object.fromEntries(
      rows<{ id: string; state: string }>(database, 'SELECT id, state FROM payment_requests').map(
        (r) => [r.id, r.state],
      ),
    );
    expect(states).toEqual({ stale: 'EXPIRED', fresh: 'PENDING', 'new-done': 'DECLINED' });
    expect(
      rows<{ resolved_at: string | null }>(
        database,
        "SELECT resolved_at FROM payment_requests WHERE id = 'stale'",
      )[0].resolved_at,
    ).not.toBeNull();
    expect(
      rows<{ token_hash: string }>(database, 'SELECT token_hash FROM game_invitations').map(
        (r) => r.token_hash,
      ),
    ).toEqual(['inv-live']);
  });

  it.fails(
    'purges completed ledger entries of games finished over ninety days ago (cleanup filters on status FINISHED, which is stored as ARCHIVED)',
    async () => {
      seedUser(database, 'u1');
      seedGame(database, 'fin-old', { owner: 'u1', status: 'ARCHIVED' });
      seedGame(database, 'fin-new', { owner: 'u1', status: 'ARCHIVED' });
      exec(
        database,
        "UPDATE games SET finished_at = datetime('now', '-91 days') WHERE id = 'fin-old'",
      );
      exec(
        database,
        "UPDATE games SET finished_at = datetime('now', '-89 days') WHERE id = 'fin-new'",
      );
      for (const [game, status] of [
        ['fin-old', 'COMPLETED'],
        ['fin-new', 'COMPLETED'],
        ['fin-old', 'PENDING'],
      ] as const) {
        exec(
          database,
          'INSERT INTO command_ledger (game_id, command_id, actor_id, command_type, payload_hash, status) VALUES (?, ?, ?, ?, ?, ?)',
          game,
          `${game}-${status}`,
          'a',
          't',
          'h',
          status,
        );
      }
      await repository.cleanupExpiredOperationalData();
      expect(
        rows<{ command_id: string }>(
          database,
          'SELECT command_id FROM command_ledger ORDER BY command_id',
        ).map((r) => r.command_id),
      ).toEqual(['fin-new-COMPLETED', 'fin-old-PENDING']);
    },
  );
});
