// @vitest-environment node
import './test-support/auto-response-stub.js';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DiceRoll } from '../shared/contracts/api.js';
import { GameSession } from './game-session.js';
import { DurableObjectDiceRollRepository } from './repositories/durable-dice-roll-repository.js';
import { d1, migratedDatabase, seedUsers } from './test-support/sqlite-d1.js';

const GAME = '00000000-0000-4000-8000-000000000001';
const A = '00000000-0000-4000-8000-0000000000a1';
const B = '00000000-0000-4000-8000-0000000000a2';

function rollId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function session(database: DatabaseSync, storage: Map<string, unknown>): GameSession {
  const context = {
    storage: {
      get: async (key: string) => storage.get(key),
      put: async (key: string, value: unknown) => {
        storage.set(key, value);
      },
      delete: async (keys: string[]) => keys.filter((key) => storage.delete(key)).length,
      list: async ({ prefix }: { prefix: string }) =>
        new Map([...storage].filter(([key]) => key.startsWith(prefix))),
    },
    setWebSocketAutoResponse: () => undefined,
    getWebSockets: () => [],
  };
  return new GameSession(
    context as unknown as DurableObjectState,
    {
      MONOPOLY_BANK_DB: d1(database),
    } as unknown as Env,
  );
}

describe('GameSession dice rolls', () => {
  let database: DatabaseSync;
  let storage: Map<string, unknown>;
  let game: GameSession;

  const call = async (method: 'GET' | 'POST', playerId: string, body?: unknown, limit?: number) => {
    const url = new URL('https://game-session/dice-rolls');
    url.searchParams.set('playerId', playerId);
    if (limit !== undefined) url.searchParams.set('limit', String(limit));
    const response = await game.fetch(
      new Request(url, {
        method,
        headers: { 'content-type': 'application/json', 'x-game-id': GAME, 'x-user-id': 'ua' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    return { status: response.status, body: (await response.json()) as { data?: unknown } };
  };
  const roll = (playerId: string, id: string, dieOne = 3, dieTwo = 4) =>
    call('POST', playerId, { id, dieOne, dieTwo });
  const list = async (playerId: string, limit?: number) =>
    (await call('GET', playerId, undefined, limit)).body.data as DiceRoll[];
  const writes = () => (database.prepare('SELECT total_changes() AS n').get() as { n: number }).n;

  beforeEach(async () => {
    database = await migratedDatabase();
    seedUsers(database, ['ua']);
    database
      .prepare(
        `INSERT INTO games (id, name, starting_balance, pass_go_reward, currency, status, payment_mode, owner_user_id)
         VALUES (?, 'Dice', 1500, 200, 'UAH', 'ACTIVE', 'FAST', 'ua')`,
      )
      .run(GAME);
    for (const player of [A, B])
      database
        .prepare(
          "INSERT INTO players (id, game_id, name, color, balance) VALUES (?, ?, 'p', '#000000', 1500)",
        )
        .run(player, GAME);
    storage = new Map();
    game = session(database, storage);
  });

  it('keeps rolls in the game object and writes nothing to D1', async () => {
    const before = writes();
    const first = await roll(A, rollId(1), 2, 5);
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ id: rollId(1), playerId: A, dieOne: 2, dieTwo: 5 });
    await roll(A, rollId(2), 6, 6);
    expect((await list(A)).map((item) => item.id)).toEqual([rollId(2), rollId(1)]);
    expect(await list(B)).toEqual([]);
    expect(writes()).toBe(before);
    expect(database.prepare('SELECT COUNT(*) AS n FROM dice_rolls').get()).toEqual({ n: 0 });
  });

  it('returns the stored roll for a retried id and refuses an id used by another player', async () => {
    const first = await roll(A, rollId(1));
    expect((await roll(A, rollId(1), 6, 6)).body.data).toEqual(first.body.data);
    const reused = await call('POST', B, { id: rollId(1), dieOne: 1, dieTwo: 1 });
    expect(reused.status).toBe(409);
    expect(reused.body).toMatchObject({ error: { code: 'DICE_ROLL_ID_REUSED' } });
    expect(await list(A)).toHaveLength(1);
  });

  it('keeps the newest hundred rolls per player and honours the limit', async () => {
    for (let index = 0; index < 102; index += 1) await roll(A, rollId(index));
    const all = await list(A, 100);
    expect(all).toHaveLength(100);
    expect(all[0]?.id).toBe(rollId(101));
    expect(all[99]?.id).toBe(rollId(2));
    expect(await list(A, 5)).toHaveLength(5);
  });

  it('carries on from rolls stored in D1 before the move', async () => {
    database
      .prepare(
        `INSERT INTO dice_rolls (id, game_id, player_id, die_one, die_two, created_at)
         VALUES (?, ?, ?, 1, 2, '2026-01-01T00:00:00.000Z')`,
      )
      .run(rollId(90), GAME, A);
    expect((await list(A)).map((item) => item.id)).toEqual([rollId(90)]);
    await roll(A, rollId(91));
    expect((await list(A)).map((item) => item.id)).toEqual([rollId(91), rollId(90)]);
    expect((await roll(B, rollId(90))).status).toBe(409);
  });

  it('shows no history once the game is finished, and refuses new rolls', async () => {
    await roll(A, rollId(1));
    database.prepare("UPDATE games SET status = 'ARCHIVED' WHERE id = ?").run(GAME);
    expect(await list(A)).toEqual([]);
    expect((await roll(A, rollId(2))).status).toBe(409);
  });

  it('clears every player history from the object and keeps its other state', async () => {
    await roll(A, rollId(1));
    await roll(B, rollId(2));
    storage.set('stateVersion', 7);
    const rolls = new DurableObjectDiceRollRepository(
      {
        get: async <T>(key: string) => storage.get(key) as T | undefined,
        put: async (key, value) => {
          storage.set(key, value);
        },
        list: async <T>({ prefix }: { prefix: string }) =>
          new Map([...storage].filter(([key]) => key.startsWith(prefix))) as Map<string, T>,
        delete: async (keys) => keys.filter((key) => storage.delete(key)).length,
      },
      d1(database),
    );
    await rolls.clear();
    expect([...storage.keys()]).toEqual(['stateVersion']);
    await rolls.clear();
    expect([...storage.keys()]).toEqual(['stateVersion']);
  });
});
