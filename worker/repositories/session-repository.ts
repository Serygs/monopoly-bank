export interface ActiveSession {
  userId: string;
  expiresAt: string;
}
export interface SessionRepository {
  create(id: string, userId: string, tokenHash: string, expiresAt: string): Promise<void>;
  findActive(tokenHash: string): Promise<ActiveSession | null>;
  renew(tokenHash: string, expiresAt: string): Promise<boolean>;
  delete(tokenHash: string): Promise<void>;
  deleteAllForUser(userId: string): Promise<void>;
  deleteExpired(): Promise<void>;
}
export class D1SessionRepository implements SessionRepository {
  private readonly database: D1Database;
  constructor(database: D1Database) {
    this.database = database;
  }
  async create(id: string, userId: string, tokenHash: string, expiresAt: string): Promise<void> {
    await this.database
      .prepare(
        'INSERT INTO user_sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
      )
      .bind(id, userId, tokenHash, expiresAt)
      .run();
  }
  async findActive(tokenHash: string): Promise<ActiveSession | null> {
    const row = await this.database
      .prepare(
        "SELECT user_id, expires_at FROM user_sessions WHERE token_hash = ? AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
      )
      .bind(tokenHash)
      .first<{ user_id: string; expires_at: string }>();
    return row === null ? null : { userId: row.user_id, expiresAt: row.expires_at };
  }
  async renew(tokenHash: string, expiresAt: string): Promise<boolean> {
    // Never shorten a lease or recreate a revoked/expired session.
    const row = await this.database
      .prepare(
        "UPDATE user_sessions SET expires_at = MAX(expires_at, ?) WHERE token_hash = ? AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now') RETURNING user_id",
      )
      .bind(expiresAt, tokenHash)
      .first<{ user_id: string }>();
    return row !== null;
  }
  async delete(tokenHash: string): Promise<void> {
    await this.database
      .prepare('DELETE FROM user_sessions WHERE token_hash = ?')
      .bind(tokenHash)
      .run();
  }
  async deleteAllForUser(userId: string): Promise<void> {
    await this.database.prepare('DELETE FROM user_sessions WHERE user_id = ?').bind(userId).run();
  }
  async deleteExpired(): Promise<void> {
    await this.database
      .prepare(
        "DELETE FROM user_sessions WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
      )
      .run();
  }
}
