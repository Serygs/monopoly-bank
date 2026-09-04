export type GameMemberRole = 'OWNER' | 'PLAYER';

export interface GameAccessRepository {
  getRole(gameId: string, userId: string): Promise<GameMemberRole | null>;
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
}
