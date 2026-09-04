export type GameMemberRole = 'OWNER' | 'PLAYER';

export interface GameAccessRepository {
  getRole(gameId: string, userId: string): Promise<GameMemberRole | null>;
  addMember(gameId: string, userId: string, role: GameMemberRole, playerId?: string): Promise<void>;
  getGameAccessCredentials(joinCode: string): Promise<{ gameId: string; passwordHash: string; passwordSalt: string } | null>;
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
  async getGameAccessCredentials(joinCode: string): Promise<{ gameId: string; passwordHash: string; passwordSalt: string } | null> { const row = await this.database.prepare('SELECT id, game_access_password_hash, game_access_password_salt FROM games WHERE join_code = ? AND owner_user_id IS NOT NULL').bind(joinCode).first<{ id: string; game_access_password_hash: string | null; game_access_password_salt: string | null }>(); if (row === null || row.game_access_password_hash === null || row.game_access_password_salt === null) return null; return { gameId: row.id, passwordHash: row.game_access_password_hash, passwordSalt: row.game_access_password_salt }; }
  async listLinkedMembers(gameId: string): Promise<Array<{ userId: string; playerId: string | null }>> { const result = await this.database.prepare('SELECT user_id, player_id FROM game_members WHERE game_id = ?').bind(gameId).all<{ user_id: string; player_id: string | null }>(); return result.results.map((row) => ({ userId: row.user_id, playerId: row.player_id })); }
}
