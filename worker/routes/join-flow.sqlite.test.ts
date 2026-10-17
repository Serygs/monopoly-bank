// @vitest-environment node
import { readdir, readFile } from 'node:fs/promises';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CreateGameRequest } from '../../shared/contracts/api.js';
import { D1GameAccessRepository } from '../repositories/game-access-repository.js';
import { D1GameRepository } from '../repositories/game-repository.js';
import { D1PlayerRepository } from '../repositories/player-repository.js';
import { GameAccessService } from '../services/game-access-service.js';
import { DefaultGameService } from '../services/game-service.js';
import { createApiRouter } from './api-router.js';

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

async function migrated(): Promise<DatabaseSync> {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  const directory = new URL('../../migrations/', import.meta.url);
  const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  for (const name of files) database.exec(await readFile(new URL(name, directory), 'utf8'));
  return database;
}

const owner = '00000000-0000-4000-8000-0000000000a1';
const alice = '00000000-0000-4000-8000-0000000000a2';
const bob = '00000000-0000-4000-8000-0000000000a3';
const guestId = '00000000-0000-4000-8000-0000000000a4';

const baseGame: CreateGameRequest = {
  name: 'Friday',
  startingBalance: 1500,
  passGoReward: 200,
  currency: 'USD',
  players: [{ name: 'Host', color: '#e05263' }],
};

interface Seats {
  data: { players: Array<{ id: string; name: string }> };
}

describe('lobby join flow against SQLite', () => {
  let database: DatabaseSync;
  let router: (request: Request) => Promise<Response>;

  const call = (user: string | null, method: string, path: string, body?: unknown) =>
    router(
      new Request(`https://example.test${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(user === null ? {} : { 'x-test-user': user }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  const create = async (extra: Partial<CreateGameRequest> = {}) => {
    const response = await call(owner, 'POST', '/api/games', { ...baseGame, ...extra });
    expect(response.status).toBe(201);
    const { data } = (await response.json()) as { data: { game: { id: string } } };
    const row = database.prepare('SELECT join_code FROM games WHERE id = ?').get(data.game.id) as {
      join_code: string;
    };
    return { id: data.game.id, code: row.join_code };
  };
  const listed = async (user: string) => {
    const { data } = (await (await call(user, 'GET', '/api/games')).json()) as {
      data: Array<{ game: { id: string } }>;
    };
    return data.map((summary) => summary.game.id);
  };
  const join = async (user: string, code: string): Promise<Seats> =>
    (await (await call(user, 'POST', '/api/games/join', { joinCode: code })).json()) as Seats;

  beforeEach(async () => {
    database = await migrated();
    for (const id of [owner, alice, bob, guestId])
      database
        .prepare(
          `INSERT INTO users (id, nickname, avatar, password_hash, password_salt) VALUES (?, ?, 'x', 'h', 's')`,
        )
        .run(id, id);
    const db = d1(database);
    const access = new GameAccessService(new D1GameAccessRepository(db));
    const games = new DefaultGameService({
      games: new D1GameRepository(db),
      players: new D1PlayerRepository(db),
      createId: () => crypto.randomUUID(),
    });
    const profile = (id: string) => ({
      id,
      nickname: id,
      avatar: 'x',
      gamesPlayed: 0,
      gamesWon: 0,
      winRate: 0,
      createdAt: '',
      updatedAt: '',
    });
    router = createApiRouter({
      games,
      access,
      banking: {} as never,
      profileStatistics: {} as never,
      auth: {
        current: async (request: Request) => {
          const user = request.headers.get('x-test-user');
          if (user === null) throw new Error('unauthenticated');
          return profile(user);
        },
        createGuest: async () => ({ profile: profile(guestId), cookie: 'session=guest' }),
      } as never,
    });
  });

  it('gives a new game a short code that the join form accepts in any case and padding', async () => {
    const { id, code } = await create();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}$/u);
    const response = await call(alice, 'POST', '/api/games/join', {
      joinCode: `  ${code.toLowerCase()} `,
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { game: { id } } });
  });

  it('shows the owner the same code the join form accepts', async () => {
    const { id, code } = await create();
    const details = (await (await call(owner, 'GET', `/api/games/${id}`)).json()) as {
      data: { joinCode: string };
    };
    expect(details.data.joinCode).toBe(code);
  });

  it('keeps a private lobby out of other lists, but not out of the creator and members', async () => {
    const { id, code } = await create();
    expect(await listed(owner)).toEqual([id]);
    expect(await listed(alice)).toEqual([]);
    await join(alice, code);
    expect(await listed(alice)).toEqual([id]);
    expect(await listed(bob)).toEqual([]);
  });

  it('lists a public lobby for everyone until it starts', async () => {
    const { id } = await create({ isPublic: true });
    expect(await listed(bob)).toEqual([id]);
    database.prepare(`UPDATE games SET status = 'ACTIVE' WHERE id = ?`).run(id);
    expect(await listed(bob)).toEqual([]);
  });

  it('refuses a public lobby that also has a password', async () => {
    const response = await call(owner, 'POST', '/api/games', {
      ...baseGame,
      isPublic: true,
      gameAccessPassword: 'secret1',
    });
    expect(response.status).toBe(400);
  });

  it('answers a non-member with 404 on every game route', async () => {
    const { id } = await create();
    const attempts: Array<[string, string]> = [
      ['GET', `/api/games/${id}`],
      ['GET', `/api/games/${id}/summary`],
      ['GET', `/api/games/${id}/activity`],
      ['GET', `/api/games/${id}/auction`],
      ['DELETE', `/api/games/${id}`],
      ['POST', `/api/games/${id}/start`],
      ['POST', `/api/games/${id}/invitations`],
    ];
    for (const [method, path] of attempts)
      expect((await call(bob, method, path)).status, `${method} ${path}`).toBe(404);
  });

  it('rejects an unknown code, a wrong password, and a missing password the same way', async () => {
    const { code } = await create({ gameAccessPassword: 'secret1' });
    for (const body of [
      { joinCode: 'ZZZZ' },
      { joinCode: code },
      { joinCode: code, gameAccessPassword: 'wrong-pass' },
    ]) {
      const response = await call(alice, 'POST', '/api/games/join', body);
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'INVALID_JOIN_CODE' },
      });
    }
    const accepted = await call(alice, 'POST', '/api/games/join', {
      joinCode: code,
      gameAccessPassword: 'secret1',
    });
    expect(accepted.status).toBe(200);
  });

  it('lets a guest join with a code and no account', async () => {
    const { id, code } = await create();
    const response = await call(null, 'POST', '/api/games/join/guest', {
      joinCode: code,
      nickname: 'Visitor',
      avatar: '🎩',
    });
    expect(response.status).toBe(201);
    expect(response.headers.get('set-cookie')).toContain('session=guest');
    await expect(response.json()).resolves.toMatchObject({
      data: { profile: { id: guestId }, game: { game: { id } } },
    });
  });

  it('refuses a guest with an invalid code', async () => {
    const response = await call(null, 'POST', '/api/games/join/guest', {
      joinCode: 'ZZZZ',
      nickname: 'Visitor',
      avatar: '🎩',
    });
    expect(response.status).toBe(404);
  });

  it('turns a seventh player away with LOBBY_FULL but keeps a seated player in', async () => {
    const { id, code } = await create({
      players: ['a', 'b', 'c', 'd', 'e', 'f'].map((name, index) => ({
        name,
        color: `#00000${index}`,
      })),
    });
    const full = await call(alice, 'POST', '/api/games/join', { joinCode: code });
    expect(full.status).toBe(409);
    await expect(full.json()).resolves.toMatchObject({ error: { code: 'LOBBY_FULL' } });
    const guest = await call(null, 'POST', '/api/games/join/guest', {
      joinCode: code,
      nickname: 'Visitor',
      avatar: '🎩',
    });
    expect(guest.status).toBe(409);
    expect((await call(owner, 'GET', `/api/games/${id}`)).status).toBe(200);
  });

  describe('removing a player', () => {
    it('lets the owner remove a joined player, who then loses access and can rejoin', async () => {
      const { id, code } = await create();
      const joined = await join(alice, code);
      const seat = joined.data.players.find((player) => player.name === alice)!;
      const removed = await call(owner, 'DELETE', `/api/games/${id}/players/${seat.id}`);
      expect(removed.status).toBe(200);
      expect(await listed(alice)).toEqual([]);
      expect((await call(alice, 'GET', `/api/games/${id}`)).status).toBe(404);
      expect((await call(alice, 'POST', '/api/games/join', { joinCode: code })).status).toBe(200);
    });

    it('is owner-only, lobby-only, and never removes the owner', async () => {
      const { id, code } = await create();
      const joined = await join(alice, code);
      const hostSeat = joined.data.players.find((player) => player.name === 'Host')!;
      const seat = joined.data.players.find((player) => player.name === alice)!;
      expect((await call(alice, 'DELETE', `/api/games/${id}/players/${seat.id}`)).status).toBe(404);
      expect((await call(bob, 'DELETE', `/api/games/${id}/players/${seat.id}`)).status).toBe(404);
      database
        .prepare(`UPDATE game_members SET player_id = ? WHERE game_id = ? AND role = 'OWNER'`)
        .run(hostSeat.id, id);
      const ownerSeat = await call(owner, 'DELETE', `/api/games/${id}/players/${hostSeat.id}`);
      expect(ownerSeat.status).toBe(409);
      database.prepare(`UPDATE games SET status = 'ACTIVE' WHERE id = ?`).run(id);
      const started = await call(owner, 'DELETE', `/api/games/${id}/players/${seat.id}`);
      expect(started.status).toBe(409);
      await expect(started.json()).resolves.toMatchObject({
        error: { code: 'PLAYER_NOT_REMOVABLE' },
      });
    });
  });

  describe('regenerating the join code', () => {
    const regenerate = (user: string, id: string) =>
      call(user, 'POST', `/api/games/${id}/join-code/regenerate`);
    const storedCode = (id: string) =>
      (
        database.prepare('SELECT join_code FROM games WHERE id = ?').get(id) as {
          join_code: string;
        }
      ).join_code;

    it('gives the owner a new code at once and the old one stops working', async () => {
      const { id, code } = await create();
      const response = await regenerate(owner, id);
      expect(response.status).toBe(200);
      const { data } = (await response.json()) as { data: { joinCode: string } };
      expect(data.joinCode).toMatch(/^[A-HJKMNP-Z2-9]{4}$/u);
      expect(data.joinCode).not.toBe(code);
      expect(storedCode(id)).toBe(data.joinCode);
      const old = await call(alice, 'POST', '/api/games/join', { joinCode: code });
      expect(old.status).toBe(404);
      await expect(old.json()).resolves.toMatchObject({ error: { code: 'INVALID_JOIN_CODE' } });
      const guestOld = await call(null, 'POST', '/api/games/join/guest', {
        joinCode: code,
        nickname: 'Visitor',
        avatar: '🎩',
      });
      expect(guestOld.status).toBe(404);
      expect(
        (await call(alice, 'POST', '/api/games/join', { joinCode: data.joinCode })).status,
      ).toBe(200);
      const details = (await (await call(owner, 'GET', `/api/games/${id}`)).json()) as {
        data: { joinCode: string };
      };
      expect(details.data.joinCode).toBe(data.joinCode);
    });

    it('leaves the players already in the game alone', async () => {
      const { id, code } = await create();
      await join(alice, code);
      await regenerate(owner, id);
      expect(await listed(alice)).toEqual([id]);
      expect((await call(alice, 'GET', `/api/games/${id}`)).status).toBe(200);
    });

    it('works while the game is running, but not once it is finished or deleted', async () => {
      const { id } = await create();
      database.prepare(`UPDATE games SET status = 'ACTIVE' WHERE id = ?`).run(id);
      expect((await regenerate(owner, id)).status).toBe(200);
      const before = storedCode(id);
      database.prepare(`UPDATE games SET status = 'ARCHIVED' WHERE id = ?`).run(id);
      const finished = await regenerate(owner, id);
      expect(finished.status).toBe(409);
      await expect(finished.json()).resolves.toMatchObject({
        error: { code: 'JOIN_CODE_UNAVAILABLE' },
      });
      expect(storedCode(id)).toBe(before);
    });

    it('refuses a player who is not the owner and hides the game from strangers', async () => {
      const { id, code } = await create();
      await join(alice, code);
      const denied = await regenerate(alice, id);
      expect(denied.status).toBe(403);
      await expect(denied.json()).resolves.toMatchObject({
        error: { code: 'GAME_OWNER_REQUIRED' },
      });
      expect((await regenerate(bob, id)).status).toBe(404);
      expect(storedCode(id)).toBe(code);
    });
  });
});
