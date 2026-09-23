import { describe, expect, it, vi } from 'vitest';
import type { CreateGameInput } from '../repositories/game-repository.js';
import type { StoredBoard } from '../repositories/property-repository.js';
import { DefaultGameService } from './game-service.js';
import { board, spaces } from './property-fixtures.test-support.js';

const classic: StoredBoard = { ...board, ownerUserId: null, sourceBoardId: null, createdAt: '' };
const privateCopy: StoredBoard = { ...board, id: 'board-copy', ownerUserId: 'someone-else', sourceBoardId: 'board-classic', createdAt: '' };
const twentyEightSpaces = Array.from({ length: 28 }, (_, index) => ({ ...spaces[index % spaces.length], id: `board-classic-space-${String(index).padStart(2, '0')}` }));

function makeService(boardId: string | null) {
  const created: { input?: CreateGameInput } = {};
  let ids = 0;
  const games = {
    createWithPlayers: vi.fn(async (input: CreateGameInput) => { created.input = input; }),
    getById: async () => ({ id: 'game', name: 'Table', startingBalance: 1500, passGoReward: 200, currency: 'USD' as const, paymentMode: 'FAST' as const, status: 'LOBBY' as const, createdAt: '', updatedAt: '', boardId }),
    listFavoriteAmounts: async () => [],
    listRecentAmounts: async () => [],
  };
  const properties = {
    getBoard: async (id: string) => (id === classic.id ? classic : id === privateCopy.id ? privateCopy : null),
    listSpaces: async () => twentyEightSpaces,
    loadPropertySlice: vi.fn(async () => ({ board, boardSpaces: twentyEightSpaces, properties: twentyEightSpaces.map((space) => ({ boardSpaceId: space.id, ownerPlayerId: null, houses: 0, mortgaged: false })), buildingBank: { housesAvailable: 32, hotelsAvailable: 12 } })),
  };
  const service = new DefaultGameService({ games: games as never, players: { listByGameId: async () => [] } as never, properties: properties as never, createId: () => `id-${++ids}` });
  return { service, games, properties, created };
}

const request = { name: 'Friday', startingBalance: 1500, passGoReward: 200, currency: 'USD' as const, players: [{ name: 'Ada', color: '#1' }] };

describe('DefaultGameService with a board', () => {
  it('creates a game on a canonical board with every ownership row and the building bank in the creation input', async () => {
    const { service, created } = makeService('board-classic');
    const details = await service.createGameForOwner('owner', { ...request, boardId: 'board-classic' });
    expect(created.input?.board).toEqual({ id: 'board-classic', spaceIds: twentyEightSpaces.map((space) => space.id), houseBankLimit: 32, hotelBankLimit: 12 });
    expect(created.input?.board?.spaceIds).toHaveLength(28);
    expect(details.game.boardId).toBe('board-classic');
    expect(details.board).toEqual(board);
    expect(details.boardSpaces).toHaveLength(28);
    expect(details.properties).toHaveLength(28);
    expect(details.buildingBank).toEqual({ housesAvailable: 32, hotelsAvailable: 12 });
  });

  it('answers NOT_FOUND for somebody else\'s board copy and for an unknown board', async () => {
    const { service, games } = makeService(null);
    await expect(service.createGameForOwner('owner', { ...request, boardId: 'board-copy' })).rejects.toMatchObject({ code: 'BOARD_NOT_FOUND', status: 404 });
    await expect(service.createGameForOwner('owner', { ...request, boardId: 'board-missing' })).rejects.toMatchObject({ code: 'BOARD_NOT_FOUND', status: 404 });
    expect(games.createWithPlayers).not.toHaveBeenCalled();
  });

  it('duplicates a board game onto the same board with a clean deed table and the board\'s bank limits', async () => {
    const { service, created } = makeService('board-classic');
    const copy = await service.duplicateGameForOwner('owner', 'game', 'table-pass');
    expect(created.input?.board).toEqual({ id: 'board-classic', spaceIds: twentyEightSpaces.map((space) => space.id), houseBankLimit: 32, hotelBankLimit: 12 });
    expect(created.input?.name).toBe('Table (Copy)');
    expect(copy.game.boardId).toBe('board-classic');
    expect(copy.properties?.every((deed) => deed.ownerPlayerId === null && deed.houses === 0 && !deed.mortgaged)).toBe(true);
  });

  it('answers BOARD_NOT_FOUND when the source board vanished before the copy was written', async () => {
    const { service, games, properties } = makeService('board-classic');
    properties.getBoard = async () => null;
    await expect(service.duplicateGameForOwner('owner', 'game', 'table-pass')).rejects.toMatchObject({ code: 'BOARD_NOT_FOUND', status: 404 });
    expect(games.createWithPlayers).not.toHaveBeenCalled();
  });

  it('duplicates a game without a board into a game without a board', async () => {
    const { service, created, properties } = makeService(null);
    const copy = await service.duplicateGameForOwner('owner', 'game', 'table-pass');
    expect(created.input).not.toHaveProperty('board');
    expect(copy.game.boardId).toBeNull();
    expect(properties.loadPropertySlice).not.toHaveBeenCalled();
  });

  it('omits every board field for a game without a board and never reads the slice', async () => {
    const { service, created, properties } = makeService(null);
    const details = await service.createGameForOwner('owner', request);
    expect(created.input).not.toHaveProperty('board');
    expect(properties.loadPropertySlice).not.toHaveBeenCalled();
    for (const field of ['board', 'boardSpaces', 'properties', 'buildingBank']) expect(details).not.toHaveProperty(field);
    expect(details.game.boardId).toBeNull();
  });
});
