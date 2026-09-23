export interface GameCompletionRepository {
  record(gameId: string, userId: string, won: boolean): Promise<boolean>;
}
/** D1's unique game/user key makes completion retries idempotent. */
export class D1GameCompletionRepository implements GameCompletionRepository {
  private readonly database: D1Database;
  constructor(database: D1Database) {
    this.database = database;
  }
  async record(gameId: string, userId: string, won: boolean): Promise<boolean> {
    const result = await this.database
      .prepare(
        'INSERT INTO game_completion_participants (game_id, user_id, won) VALUES (?, ?, ?) ON CONFLICT(game_id, user_id) DO NOTHING',
      )
      .bind(gameId, userId, won ? 1 : 0)
      .run();
    return result.meta.changes === 1;
  }
}
