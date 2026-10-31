import { describe, expect, it, vi } from 'vitest';
import { buildGameSettings } from '../../shared/domain/game-rules.js';
import { defaultGameRules } from '../../shared/types/monopoly.js';
import { DefaultGameService } from './game-service.js';

const baseGame = {
  id: 'game',
  name: 'Table',
  startingBalance: 15_000_000,
  passGoReward: 2_000_000,
  currency: 'USD' as const,
  paymentMode: 'FAST' as const,
  rules: defaultGameRules,
  status: 'LOBBY' as const,
  createdAt: '',
  updatedAt: '',
  startedAt: null,
  finishedAt: null,
};
const request = {
  name: 'Table',
  startingBalance: 15_000_000,
  passGoReward: 2_000_000,
  currency: 'USD' as const,
  players: [{ name: 'Ada', color: '#123456' }],
};

function build(settings: ReturnType<typeof buildGameSettings> | null, listByGame?: () => never) {
  const createWithPlayers = vi.fn(async () => undefined);
  const service = new DefaultGameService({
    games: {
      createWithPlayers,
      getById: async () => ({ ...baseGame, settings }),
      listFavoriteAmounts: async () => [],
      listRecentAmounts: async () => [],
    } as never,
    players: { listByGameId: async () => [] } as never,
    ...(listByGame ? { properties: { listByGame: listByGame as never } } : {}),
    createId: () => 'id',
  });
  return { service, createWithPlayers };
}

describe('DefaultGameService board', () => {
  it('snapshots the chosen board into the settings, with 28 tiles to seed', async () => {
    const { service, createWithPlayers } = build(null);
    await service.createGameForOwner('owner', { ...request, board: 'monopoly-ru-2012' });
    const [input] = createWithPlayers.mock.calls[0] as unknown as [
      { settings: { board?: { presetId: string; tiles: unknown[] } } },
    ];
    expect(input.settings.board?.presetId).toBe('monopoly-ru-2012');
    expect(input.settings.board?.tiles).toHaveLength(28);
  });

  it('snapshots the Ukrainian board with its own id and 28 tiles to seed', async () => {
    const { service, createWithPlayers } = build(null);
    await service.createGameForOwner('owner', { ...request, board: 'monopoly-ua-classic' });
    const [input] = createWithPlayers.mock.calls[0] as unknown as [
      { settings: { board?: { presetId: string; tiles: unknown[] } } },
    ];
    expect(input.settings.board?.presetId).toBe('monopoly-ua-classic');
    expect(input.settings.board?.tiles).toHaveLength(28);
  });

  it.each([undefined, 'none' as const])('adds no board for %s', async (board) => {
    const { service, createWithPlayers } = build(null);
    await service.createGameForOwner('owner', { ...request, ...(board ? { board } : {}) });
    const [input] = createWithPlayers.mock.calls[0] as unknown as [{ settings: unknown }];
    expect(input.settings).toEqual(buildGameSettings(15_000_000));
    expect(input.settings).not.toHaveProperty('board');
  });

  it('copies the board mode when a game is duplicated', async () => {
    const settings = buildGameSettings(15_000_000, 'monopoly-ru-2012');
    const { service, createWithPlayers } = build(settings);
    await service.duplicateGameForOwner('owner', 'game', 'secret');
    const [input] = createWithPlayers.mock.calls[0] as unknown as [
      { settings: { board?: { presetId: string } } },
    ];
    expect(input.settings.board?.presetId).toBe('monopoly-ru-2012');
  });

  it('does not add a board when duplicating a game without one', async () => {
    const { service, createWithPlayers } = build(buildGameSettings(15_000_000));
    await service.duplicateGameForOwner('owner', 'game', 'secret');
    const [input] = createWithPlayers.mock.calls[0] as unknown as [{ settings: object }];
    expect(input.settings).not.toHaveProperty('board');
  });

  it('reports properties only for a game with a board', async () => {
    const properties = [
      { gameId: 'game', tileId: 'old_kent_road', ownerPlayerId: null, mortgaged: false, houses: 0 },
    ];
    const listByGame = vi.fn(async () => properties);
    const withBoard = build(buildGameSettings(15_000_000, 'monopoly-ru-2012'), listByGame as never);
    await expect(withBoard.service.getGame('game')).resolves.toMatchObject({ properties });

    for (const settings of [null, buildGameSettings(15_000_000)]) {
      const legacy = build(settings, listByGame as never);
      await expect(legacy.service.getGame('game')).resolves.not.toHaveProperty('properties');
    }
    expect(listByGame).toHaveBeenCalledTimes(1);
  });
});
