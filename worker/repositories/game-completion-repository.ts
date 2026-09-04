export interface GameCompletionRepository { record(gameId: string, userId: string, won: boolean): Promise<boolean>; incrementProfile(userId: string, won: boolean): Promise<void>; }
/** D1's unique game/user key makes completion retries idempotent. */
export class D1GameCompletionRepository implements GameCompletionRepository {
  private readonly database: D1Database;
  constructor(database: D1Database) { this.database = database; }
  async record(gameId: string, userId: string, won: boolean): Promise<boolean> { const result = await this.database.prepare('INSERT INTO game_completion_participants (game_id, user_id, won) VALUES (?, ?, ?) ON CONFLICT(game_id, user_id) DO NOTHING').bind(gameId, userId, won ? 1 : 0).run(); return result.meta.changes === 1; }
  async incrementProfile(userId: string, won: boolean): Promise<void> { await this.database.prepare('UPDATE users SET games_played = games_played + 1, games_won = games_won + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(won ? 1 : 0, userId).run(); }
}
