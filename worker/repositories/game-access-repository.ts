export type GameMemberRole = 'OWNER' | 'PLAYER';

export interface GameAccessRepository {
  getRole(gameId: string, userId: string): Promise<GameMemberRole | null>;
  addMember(gameId: string, userId: string, role: GameMemberRole, playerId?: string): Promise<void>;
  joinLobby(input: { gameId: string; userId: string; nickname: string; playerId: string; color: string; startingBalance: number }): Promise<boolean>;
  getGameAccessCredentials(joinCode: string): Promise<{ gameId: string; passwordHash: string | null; passwordSalt: string | null; status: string } | null>;
  getOwnerJoinCode(gameId: string, userId: string): Promise<string | null>;
  createInvitation(gameId: string, ownerUserId: string, tokenHash: string, expiresAt: string): Promise<boolean>;
  findInvitation(tokenHash: string): Promise<{ gameId: string; status: string } | null>;
  listLinkedMembers(gameId: string): Promise<Array<{ userId: string; playerId: string | null }>>;
}

export class D1GameAccessRepository implements GameAccessRepository {
  private readonly database: D1Database;

  constructor(database: D1Database) {
    this.database = database;
  }

  async getRole(gameId: string, userId: string): Promise<GameMemberRole | null> {
    const row = await this.database.prepare(
      `SELECT game_members.role
       FROM games
       INNER JOIN game_members ON game_members.game_id = games.id
       WHERE games.id = ? AND games.owner_user_id IS NOT NULL AND game_members.user_id = ?`,
    ).bind(gameId, userId).first<{ role: GameMemberRole }>();
    return row?.role ?? null;
  }
  async addMember(gameId: string, userId: string, role: GameMemberRole, playerId?: string): Promise<void> { await this.database.prepare('INSERT INTO game_members (game_id, user_id, role, player_id) VALUES (?, ?, ?, ?) ON CONFLICT(game_id, user_id) DO UPDATE SET role = excluded.role, player_id = COALESCE(game_members.player_id, excluded.player_id)').bind(gameId, userId, role, playerId ?? null).run(); }
  async joinLobby(input: { gameId: string; userId: string; nickname: string; playerId: string; color: string; startingBalance: number }): Promise<boolean> {
    const alreadyMember = await this.getRole(input.gameId, input.userId);
    if (alreadyMember !== null) return true;
    const insertPlayer = this.database.prepare(
      `INSERT INTO players (id, game_id, name, color, balance)
       SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM games WHERE id = ? AND status = 'LOBBY')
         AND NOT EXISTS (SELECT 1 FROM game_members WHERE game_id = ? AND user_id = ?)
         AND (SELECT COUNT(*) FROM players WHERE game_id = ?) < 6`,
    ).bind(input.playerId, input.gameId, input.nickname, input.color, input.startingBalance, input.gameId, input.gameId, input.userId, input.gameId);
    const insertMember = this.database.prepare(
      `INSERT INTO game_members (game_id, user_id, role, player_id)
       SELECT ?, ?, 'PLAYER', ? WHERE EXISTS (SELECT 1 FROM players WHERE id = ? AND game_id = ?)`,
    ).bind(input.gameId, input.userId, input.playerId, input.playerId, input.gameId);
    const result = await this.database.batch([insertPlayer, insertMember]);
    return result[0].meta.changes === 1;
  }
  async getGameAccessCredentials(joinCode: string): Promise<{ gameId: string; passwordHash: string | null; passwordSalt: string | null; status: string } | null> { const row = await this.database.prepare('SELECT id, game_access_password_hash, game_access_password_salt, status FROM games WHERE join_code = ? AND owner_user_id IS NOT NULL').bind(joinCode).first<{ id: string; game_access_password_hash: string | null; game_access_password_salt: string | null; status: string }>(); return row === null ? null : { gameId: row.id, passwordHash: row.game_access_password_hash, passwordSalt: row.game_access_password_salt, status: row.status }; }
  async getOwnerJoinCode(gameId: string, userId: string): Promise<string | null> { const row = await this.database.prepare("SELECT games.join_code FROM games INNER JOIN game_members ON game_members.game_id = games.id WHERE games.id = ? AND games.owner_user_id IS NOT NULL AND game_members.user_id = ? AND game_members.role = 'OWNER'").bind(gameId, userId).first<{ join_code: string | null }>(); return row?.join_code ?? null; }
  async createInvitation(gameId: string, ownerUserId: string, tokenHash: string, expiresAt: string): Promise<boolean> { const result = await this.database.prepare(`INSERT INTO game_invitations (token_hash, game_id, created_by_user_id, expires_at) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM games WHERE id = ? AND status = 'LOBBY')`).bind(tokenHash, gameId, ownerUserId, expiresAt, gameId).run(); return result.meta.changes === 1; }
  async findInvitation(tokenHash: string): Promise<{ gameId: string; status: string } | null> { const row = await this.database.prepare(`SELECT games.id, games.status FROM game_invitations INNER JOIN games ON games.id = game_invitations.game_id WHERE game_invitations.token_hash = ? AND game_invitations.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`).bind(tokenHash).first<{ id: string; status: string }>(); return row === null ? null : { gameId: row.id, status: row.status }; }
  async listLinkedMembers(gameId: string): Promise<Array<{ userId: string; playerId: string | null }>> { const result = await this.database.prepare('SELECT user_id, player_id FROM game_members WHERE game_id = ?').bind(gameId).all<{ user_id: string; player_id: string | null }>(); return result.results.map((row) => ({ userId: row.user_id, playerId: row.player_id })); }
}
