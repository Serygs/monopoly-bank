import { describe, expect, it } from 'vitest';
import type { GameRepository } from '../repositories/game-repository.js';
import { ResourceNotFoundError } from './errors.js';
import { DefaultGameService } from './game-service.js';

function service(games: Partial<GameRepository>) {
  return new DefaultGameService({
    games: games as GameRepository,
    players: {} as never,
    createId: () => 'id',
  });
}

describe('DefaultGameService deleted games', () => {
  it('soft-deletes a game and reports a missing or already deleted one as not found', async () => {
    const softDeleted: string[] = [];
    const found = service({
      softDelete: async (id) => {
        softDeleted.push(id);
        return true;
      },
    });
    await expect(found.deleteGame('game-1')).resolves.toEqual({ gameId: 'game-1' });
    expect(softDeleted).toEqual(['game-1']);

    await expect(service({ softDelete: async () => false }).deleteGame('game-1')).rejects.toThrow(
      ResourceNotFoundError,
    );
  });

  it('restores for the requesting owner and reports a missing or expired game as not found', async () => {
    const restored: Array<[string, string]> = [];
    const found = service({
      restore: async (id, userId) => {
        restored.push([id, userId]);
        return true;
      },
    });
    await expect(found.restoreGame('game-1', 'owner')).resolves.toEqual({ gameId: 'game-1' });
    expect(restored).toEqual([['game-1', 'owner']]);

    await expect(
      service({ restore: async () => false }).restoreGame('game-1', 'owner'),
    ).rejects.toThrow(ResourceNotFoundError);
  });

  it("lists the user's deleted games from the repository", async () => {
    const list = service({
      listDeletedSummariesForUser: async (userId) => {
        expect(userId).toBe('owner');
        return [];
      },
    });
    await expect(list.listDeletedGamesForUser('owner')).resolves.toEqual([]);
  });
});
