import { describe, expect, it } from 'vitest';
import { DefaultGameService } from './game-service.js';
import { ConflictError } from './errors.js';
import type { Game } from '../../shared/types/monopoly.js';

const game = { id: 'game', name: 'Table', startingBalance: 1500, passGoReward: 200, currency: 'K' as const, status: 'LOBBY' as const, createdAt: '', updatedAt: '', startedAt: null, finishedAt: null };
const players = [{ id: 'player-1', gameId: 'game', name: 'Ada', color: '#123456', balance: 1500, status: 'ACTIVE' as const, createdAt: '' }, { id: 'player-2', gameId: 'game', name: 'Lin', color: '#654321', balance: 1500, status: 'ACTIVE' as const, createdAt: '' }];

describe('DefaultGameService lifecycle', () => {
  it('starts only a lobby with at least two players and finishes only an active game', async () => {
    let current: Game = game;
    const service = new DefaultGameService({ games: { getById: async () => current, transitionStatus: async (_id, from, to) => { if (current.status !== from) return null; current = { ...current, status: to }; return current; }, listFavoriteAmounts: async () => [], listRecentAmounts: async () => [] } as never, players: { listByGameId: async () => players } as never, createId: () => 'unused' });
    await expect(service.startGame('game')).resolves.toMatchObject({ game: { status: 'ACTIVE' } });
    await expect(service.finishGame('game')).resolves.toMatchObject({ game: { status: 'FINISHED' } });
    await expect(service.finishGame('game')).rejects.toBeInstanceOf(ConflictError);
  });
});
