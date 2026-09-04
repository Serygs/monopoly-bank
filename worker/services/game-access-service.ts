import type { GameMemberRole, GameAccessRepository } from '../repositories/game-access-repository.js';
import { ResourceNotFoundError } from './errors.js';

export class GameAccessService {
  private readonly access: GameAccessRepository;

  constructor(access: GameAccessRepository) {
    this.access = access;
  }

  async requireMember(gameId: string, userId: string): Promise<GameMemberRole> {
    const role = await this.access.getRole(gameId, userId);
    if (role === null) throw new ResourceNotFoundError('Game');
    return role;
  }

  async requireOwner(gameId: string, userId: string): Promise<void> {
    if (await this.requireMember(gameId, userId) !== 'OWNER') throw new ResourceNotFoundError('Game');
  }
}
