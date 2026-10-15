import { describe, expect, it } from 'vitest';
import type { DiceRoll, RecordDiceRollRequest } from '../../shared/contracts/api.js';
import { ForbiddenError } from '../services/errors.js';
import type { DiceRollService } from '../services/dice-roll-service.js';
import { createApiRouter } from './api-router.js';

const gameId = '00000000-0000-4000-8000-000000000001';
const playerId = '00000000-0000-4000-8000-000000000002';
const rollId = '00000000-0000-4000-8000-0000000000a1';
const url = `https://example.test/api/games/${gameId}/players/${playerId}/dice-rolls`;

const roll: DiceRoll = {
  id: rollId,
  playerId,
  dieOne: 3,
  dieTwo: 4,
  createdAt: '2026-10-15T10:00:00.000Z',
};

function createRouter(
  options: {
    diceRolls?: DiceRollService | undefined;
    controls?: boolean;
    member?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const diceRolls: DiceRollService | undefined =
    'diceRolls' in options
      ? options.diceRolls
      : {
          record: async (_game, _player, input: RecordDiceRollRequest) => {
            calls.push(`record:${input.id}:${input.dieOne}:${input.dieTwo}`);
            return roll;
          },
          list: async (_game, _player, limit) => {
            calls.push(`list:${limit}`);
            return [roll];
          },
        };
  const router = createApiRouter({
    games: {} as never,
    banking: {} as never,
    auth: {
      current: async () => ({
        id: '00000000-0000-4000-8000-000000000099',
        nickname: 'Test',
        avatar: '🧩',
        gamesPlayed: 0,
        gamesWon: 0,
        winRate: 0,
        createdAt: '',
        updatedAt: '',
      }),
    } as never,
    access: {
      requireMember: async () => {
        calls.push('member');
        if (options.member === false) throw new ForbiddenError();
        return 'PLAYER';
      },
      requirePlayerController: async () => {
        calls.push('controller');
        if (options.controls === false) throw new ForbiddenError();
      },
      controlledWallets: async () => [],
    } as never,
    profileStatistics: {} as never,
    ...(diceRolls === undefined ? {} : { diceRolls }),
  });
  return { router, calls };
}

function post(body: unknown, target = url) {
  return new Request(target, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('dice roll routes', () => {
  it('records a roll for a wallet the caller controls', async () => {
    const { router, calls } = createRouter();
    const response = await router(post({ id: rollId, dieOne: 3, dieTwo: 4 }));
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ data: roll });
    expect(calls).toEqual(['member', 'controller', `record:${rollId}:3:4`]);
  });

  it('refuses to record for a wallet the caller does not control', async () => {
    const { router, calls } = createRouter({ controls: false });
    const response = await router(post({ id: rollId, dieOne: 3, dieTwo: 4 }));
    expect(response.status).toBe(403);
    expect(calls).toEqual(['member', 'controller']);
  });

  it.each([
    [{ id: rollId, dieOne: 0, dieTwo: 4 }],
    [{ id: rollId, dieOne: 3, dieTwo: 7 }],
    [{ id: rollId, dieOne: 2.5, dieTwo: 4 }],
    [{ id: rollId, dieOne: '3', dieTwo: 4 }],
    [{ id: 'not-a-uuid', dieOne: 3, dieTwo: 4 }],
    [{ dieOne: 3, dieTwo: 4 }],
  ])('rejects an invalid roll %j before the service is called', async (body) => {
    const { router, calls } = createRouter();
    const response = await router(post(body));
    expect(response.status).toBe(400);
    expect(calls.filter((call) => call.startsWith('record'))).toEqual([]);
  });

  it("lets any game member read a player's history, 20 rolls by default", async () => {
    const { router, calls } = createRouter({ controls: false });
    const response = await router(new Request(url));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: [roll] });
    expect(calls).toEqual(['member', 'list:20']);
  });

  it('honours a valid limit and rejects an out-of-range one', async () => {
    const { router, calls } = createRouter();
    expect((await router(new Request(`${url}?limit=5`))).status).toBe(200);
    expect(calls).toContain('list:5');
    expect((await router(new Request(`${url}?limit=0`))).status).toBe(400);
    expect((await router(new Request(`${url}?limit=101`))).status).toBe(400);
  });

  it('rejects outsiders before anything else', async () => {
    const { router, calls } = createRouter({ member: false });
    expect((await router(new Request(url))).status).toBe(403);
    expect(calls).toEqual(['member']);
  });

  it('rejects ids that are not UUIDs', async () => {
    const { router } = createRouter();
    const bad = `https://example.test/api/games/${gameId}/players/not-a-uuid/dice-rolls`;
    expect((await router(new Request(bad))).status).toBe(400);
  });

  it('answers 409 when dice history is not configured', async () => {
    const { router } = createRouter({ diceRolls: undefined });
    expect((await router(new Request(url))).status).toBe(409);
  });

  it('rejects cross-origin mutations before the service writes', async () => {
    const { router, calls } = createRouter();
    const response = await router(
      new Request(url, {
        method: 'POST',
        headers: { origin: 'https://attacker.test', 'content-type': 'application/json' },
        body: JSON.stringify({ id: rollId, dieOne: 3, dieTwo: 4 }),
      }),
    );
    expect(response.status).toBe(403);
    expect(calls).toEqual([]);
  });
});
