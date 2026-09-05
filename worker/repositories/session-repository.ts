export interface SessionRepository { create(id: string, userId: string, tokenHash: string, expiresAt: string): Promise<void>; findUserId(tokenHash: string): Promise<string | null>; delete(tokenHash: string): Promise<void>; deleteAllForUser(userId: string): Promise<void>; }
export class D1SessionRepository implements SessionRepository {
  private readonly database: D1Database;
  constructor(database: D1Database) { this.database = database; }
  async create(id: string, userId: string, tokenHash: string, expiresAt: string): Promise<void> { await this.database.prepare('INSERT INTO user_sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)').bind(id, userId, tokenHash, expiresAt).run(); }
  async findUserId(tokenHash: string): Promise<string | null> { const row = await this.database.prepare("SELECT user_id FROM user_sessions WHERE token_hash = ? AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')").bind(tokenHash).first<{ user_id: string }>(); return row?.user_id ?? null; }
  async delete(tokenHash: string): Promise<void> { await this.database.prepare('DELETE FROM user_sessions WHERE token_hash = ?').bind(tokenHash).run(); }
  async deleteAllForUser(userId: string): Promise<void> { await this.database.prepare('DELETE FROM user_sessions WHERE user_id = ?').bind(userId).run(); }
}
