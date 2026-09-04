import { describe, expect, it } from 'vitest';

import type { GameAccessRepository } from '../repositories/game-access-repository.js';
import { ResourceNotFoundError } from './errors.js';
import { GameAccessService } from './game-access-service.js';

function accessFor(role: 'OWNER' | 'PLAYER' | null): GameAccessService {
  const repository: GameAccessRepository = { getRole: async () => role };
  return new GameAccessService(repository);
}

describe('authenticated game access', () => {
  it('allows an owner to access their game', async () => {
    await expect(accessFor('OWNER').requireMember('game', 'user')).resolves.toBe('OWNER');
  });

  it('does not expose an unowned legacy game through normal user access', async () => {
    await expect(accessFor(null).requireMember('legacy-game', 'user')).rejects.toBeInstanceOf(ResourceNotFoundError);
  });
});
