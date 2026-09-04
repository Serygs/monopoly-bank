import type { GameMemberRole, GameAccessRepository } from '../repositories/game-access-repository.js';
import { ResourceNotFoundError } from './errors.js';
import { verifyPassword } from './password-security.js';

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

  async grantPlayer(gameId: string, userId: string, playerId?: string): Promise<void> { await this.access.addMember(gameId, userId, 'PLAYER', playerId); }
  async getJoinCredentials(joinCode: string): Promise<{ gameId: string; passwordHash: string; passwordSalt: string } | null> { return this.access.getGameAccessCredentials(joinCode); }
  async ownerJoinCode(gameId: string, userId: string): Promise<string> { const joinCode = await this.access.getOwnerJoinCode(gameId, userId); if (joinCode === null) throw new ResourceNotFoundError('Game'); return joinCode; }
  async verifyGamePassword(password: string, credentials: { passwordHash: string; passwordSalt: string }): Promise<boolean> { return verifyPassword(password, { hash: credentials.passwordHash, salt: credentials.passwordSalt }); }
  async linkedMembers(gameId: string): Promise<Array<{ userId: string; playerId: string | null }>> { return this.access.listLinkedMembers(gameId); }
}
