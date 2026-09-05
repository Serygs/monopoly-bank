import { describe, expect, it } from 'vitest';

import type { GameAccessRepository } from '../repositories/game-access-repository.js';
import { ForbiddenError, ResourceNotFoundError } from './errors.js';
import { GameAccessService } from './game-access-service.js';

function accessFor(role: 'OWNER' | 'PLAYER' | null, controlsPlayer = true): GameAccessService {
  const repository: GameAccessRepository = {
    getRole: async () => role,
    isPlayerControlledBy: async () => controlsPlayer,
    listPlayerControllers: async () => [{ playerId: 'wallet', kind: 'PRIMARY' }],
  } as GameAccessRepository;
  return new GameAccessService(repository);
}

describe('authenticated game access', () => {
  it('allows an owner to access their game', async () => {
    await expect(accessFor('OWNER').requireMember('game', 'user')).resolves.toBe('OWNER');
  });

  it('does not expose an unowned legacy game through normal user access', async () => {
    await expect(accessFor(null).requireMember('legacy-game', 'user')).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it('rejects a member attempting to operate a wallet they do not control', async () => {
    await expect(accessFor('OWNER', false).requirePlayerController('game', 'owner', 'other-wallet')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('returns the actor wallet controls independently of their membership role', async () => {
    await expect(accessFor('PLAYER').controlledWallets('game', 'user')).resolves.toEqual([{ playerId: 'wallet', kind: 'PRIMARY' }]);
  });

  it('treats a duplicate concurrent join as an idempotent success', async () => {
    const service = new GameAccessService({ joinLobby: async () => false, getRole: async () => 'PLAYER' } as GameAccessRepository);
    await expect(service.joinLobby({ gameId: 'game', userId: 'user', nickname: 'Ada', playerId: 'player', color: '#123456', startingBalance: 1500 })).resolves.toBeUndefined();
  });

  it('rejects a full six-player lobby without creating an additional membership', async () => {
    const service = new GameAccessService({ joinLobby: async () => false, getRole: async () => null } as GameAccessRepository);
    await expect(service.joinLobby({ gameId: 'game', userId: 'seventh', nickname: 'Seventh', playerId: 'player', color: '#123456', startingBalance: 1500 })).rejects.toMatchObject({ code: 'LOBBY_CLOSED' });
  });
});
