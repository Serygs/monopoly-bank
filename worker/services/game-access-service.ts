import type { CreateInvitationResponse, PlayerController } from '../../shared/contracts/api.js';
import type { GameMemberRole, GameAccessRepository } from '../repositories/game-access-repository.js';
import { ConflictError, ForbiddenError, ResourceNotFoundError } from './errors.js';
import { randomToken, tokenHash, verifyPassword } from './password-security.js';

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

  async requirePlayerController(gameId: string, userId: string, playerId: string): Promise<void> {
    if (!(await this.access.isPlayerControlledBy(gameId, userId, playerId))) throw new ForbiddenError();
  }

  async controlledWallets(gameId: string, userId: string): Promise<PlayerController[]> {
    return this.access.listPlayerControllers(gameId, userId);
  }

  async joinLobby(input: { gameId: string; userId: string; nickname: string; playerId: string; color: string; startingBalance: number }): Promise<void> {
    if (await this.access.joinLobby(input)) return;
    if (await this.access.getRole(input.gameId, input.userId) !== null) return;
    throw new ConflictError('LOBBY_CLOSED', 'This lobby is no longer open for new players.');
  }
  async getJoinCredentials(joinCode: string): Promise<{ gameId: string; passwordHash: string | null; passwordSalt: string | null; status: string } | null> { return this.access.getGameAccessCredentials(joinCode); }
  async ownerJoinCode(gameId: string, userId: string): Promise<string> { const joinCode = await this.access.getOwnerJoinCode(gameId, userId); if (joinCode === null) throw new ResourceNotFoundError('Game'); return joinCode; }
  async createInvitation(gameId: string, ownerUserId: string): Promise<CreateInvitationResponse> {
    const invitationToken = randomToken();
    const shortCode = randomToken(6).toUpperCase().replace(/[^A-Z0-9]/gu, 'X');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    if (!(await this.access.createInvitation({ gameId, ownerUserId, tokenHash: await tokenHash(invitationToken), shortCode, expiresAt, visibility: 'UNLISTED' }))) throw new ConflictError('LOBBY_CLOSED', 'This lobby is no longer open for new players.');
    return { invitationToken, shortCode, expiresAt, visibility: 'UNLISTED' };
  }
  async revokeInvitations(gameId: string, ownerUserId: string): Promise<void> {
    if (!(await this.access.revokeInvitations(gameId, ownerUserId))) throw new ConflictError('INVITATION_NOT_ACTIVE', 'There is no active invitation to revoke.');
  }
  async invitation(token: string): Promise<{ gameId: string; status: string } | null> { return this.access.findInvitation(await tokenHash(token)); }
  async verifyGamePassword(password: string | undefined, credentials: { passwordHash: string | null; passwordSalt: string | null }): Promise<boolean> { return credentials.passwordHash === null || credentials.passwordSalt === null ? true : password !== undefined && verifyPassword(password, { hash: credentials.passwordHash, salt: credentials.passwordSalt }); }
  async linkedMembers(gameId: string): Promise<Array<{ userId: string; playerId: string | null }>> { return this.access.listLinkedMembers(gameId); }
}
