import { describe, expect, it, vi } from 'vitest';
import type { BoardSpace } from '../../shared/types/monopoly.js';
import type { CreateBoardInput, StoredBoard } from '../repositories/property-repository.js';
import { BoardService } from './board-service.js';
import { board, spaces } from './property-fixtures.test-support.js';

const classic: StoredBoard = { ...board, ownerUserId: null, sourceBoardId: null, createdAt: '2026-01-01' };
const ownCopy: StoredBoard = { ...board, id: 'board-own', name: 'Mine', ownerUserId: 'me', sourceBoardId: 'board-classic', createdAt: '2026-02-01' };
const foreignCopy: StoredBoard = { ...board, id: 'board-foreign', name: 'Theirs', ownerUserId: 'them', sourceBoardId: 'board-classic', createdAt: '2026-03-01' };
const classicSpaces: BoardSpace[] = Array.from({ length: 28 }, (_, index) => ({ ...spaces[index % spaces.length], id: `board-classic-space-${String(index).padStart(2, '0')}`, boardIndex: index + 1 }));
const names = Object.fromEntries(classicSpaces.map((space, index) => [space.id, `Street ${index}`]));

function makeService(options: { owned?: number; visibleThroughGame?: boolean; gamesUsing?: number } = {}) {
  let ids = 0;
  const created: StoredBoard[] = [];
  const boards = {
    getBoard: async (id: string) => [classic, ownCopy, foreignCopy, ...created].find((candidate) => candidate.id === id) ?? null,
    listSpaces: async (id: string) => (id === classic.id ? classicSpaces : classicSpaces.map((space) => ({ ...space, id: `${id}-${space.boardIndex}`, customName: 'Named' }))),
    listBoardsForUser: async () => [classic, ownCopy],
    countBoardsOwnedBy: async () => options.owned ?? 0,
    createBoard: vi.fn(async (input: CreateBoardInput) => { created.push({ ...input.board, createdAt: '2026-04-01' }); }),
    isBoardVisibleThroughGame: async () => options.visibleThroughGame ?? false,
    countGamesUsingBoard: async () => options.gamesUsing ?? 0,
    deleteBoard: vi.fn(async () => true),
  };
  return { boards, service: new BoardService({ boards: boards as never, createId: () => `id-${++ids}` }) };
}

describe('BoardService', () => {
  it('lists canonical and owned boards without catalogue-only columns', async () => {
    const { service } = makeService();
    const list = await service.list('me');
    expect(list).toEqual([
      { board, isCanonical: true, sourceBoardId: null, createdAt: '2026-01-01' },
      { board: { ...board, id: 'board-own', name: 'Mine' }, isCanonical: false, sourceBoardId: 'board-classic', createdAt: '2026-02-01' },
    ]);
    expect(list[0].board).not.toHaveProperty('ownerUserId');
  });

  it('copies a canonical board with 28 custom names and identical prices, groups and rents in one write', async () => {
    const { service, boards } = makeService();
    await service.create('me', { name: 'Kyiv', sourceBoardId: 'board-classic', spaceNames: names });
    expect(boards.createBoard).toHaveBeenCalledTimes(1);
    const input = boards.createBoard.mock.calls[0][0];
    expect(input.board).toEqual({ ...board, id: 'id-1', name: 'Kyiv', ownerUserId: 'me', sourceBoardId: 'board-classic' });
    expect(input.spaces).toHaveLength(28);
    expect(new Set(input.spaces.map((space) => space.id)).size).toBe(28);
    input.spaces.forEach((space, index) => {
      const source = classicSpaces[index];
      expect(space).toMatchObject({ boardIndex: source.boardIndex, kind: source.kind, colorGroup: source.colorGroup, translationKey: source.translationKey, price: source.price, mortgageValue: source.mortgageValue, houseCost: source.houseCost, rents: source.rents, customName: `Street ${index}` });
    });
  });

  it('rejects a name set that does not cover the source spaces exactly once', async () => {
    const { service, boards } = makeService();
    const [first, ...rest] = Object.entries(names);
    await expect(service.create('me', { name: 'Kyiv', sourceBoardId: 'board-classic', spaceNames: Object.fromEntries(rest) })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', details: { expected: 28, provided: 27, missing: [first[0]] } });
    await expect(service.create('me', { name: 'Kyiv', sourceBoardId: 'board-classic', spaceNames: { ...names, 'board-classic-space-99': 'Extra' } })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', details: { provided: 29, unknown: ['board-classic-space-99'] } });
    expect(boards.createBoard).not.toHaveBeenCalled();
  });

  it('refuses an eleventh board and a source the caller may not see', async () => {
    const { service, boards } = makeService({ owned: 10 });
    await expect(service.create('me', { name: 'Kyiv', sourceBoardId: 'board-classic', spaceNames: names })).rejects.toMatchObject({ code: 'BOARD_LIMIT_REACHED', status: 409 });
    await expect(service.create('me', { name: 'Kyiv', sourceBoardId: 'board-foreign', spaceNames: names })).rejects.toMatchObject({ code: 'BOARD_NOT_FOUND', status: 404 });
    expect(boards.createBoard).not.toHaveBeenCalled();
  });

  it('hides a foreign copy from strangers but shows it to a member of a game played on it', async () => {
    await expect(makeService().service.get('board-foreign', 'me')).rejects.toMatchObject({ code: 'BOARD_NOT_FOUND', status: 404 });
    await expect(makeService({ visibleThroughGame: true }).service.get('board-foreign', 'me')).resolves.toMatchObject({ board: { id: 'board-foreign' }, isCanonical: false, spaces: expect.any(Array) });
    await expect(makeService().service.get('board-classic', 'anyone')).resolves.toMatchObject({ isCanonical: true });
    await expect(makeService().service.get('board-own', 'me')).resolves.toMatchObject({ board: { id: 'board-own' } });
  });

  it('deletes only an owned board that no game references', async () => {
    const free = makeService();
    await expect(free.service.delete('board-own', 'me')).resolves.toEqual({ boardId: 'board-own' });
    expect(free.boards.deleteBoard).toHaveBeenCalledWith('board-own', 'me');
    await expect(makeService({ gamesUsing: 1 }).service.delete('board-own', 'me')).rejects.toMatchObject({ code: 'BOARD_IN_USE', status: 409 });
    await expect(makeService().service.delete('board-foreign', 'me')).rejects.toMatchObject({ code: 'BOARD_NOT_FOUND' });
    await expect(makeService().service.delete('board-classic', 'me')).rejects.toMatchObject({ code: 'BOARD_NOT_FOUND' });
    const restricted = makeService();
    restricted.boards.deleteBoard.mockRejectedValueOnce(new Error('D1_ERROR: FOREIGN KEY constraint failed'));
    await expect(restricted.service.delete('board-own', 'me')).rejects.toMatchObject({ code: 'BOARD_IN_USE' });
  });
});
