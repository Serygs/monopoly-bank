import { DatabaseError, isUniqueConstraintError } from '../services/errors.js';

export type AuthTokenPurpose = 'VERIFY_EMAIL' | 'RESET_PASSWORD';

export interface AuthTokenRepository {
  issue(input: { id: string; userId: string; purpose: AuthTokenPurpose; tokenHash: string; expiresAt: string; replaceActive?: boolean }): Promise<boolean>;
  consume(tokenHash: string, purpose: AuthTokenPurpose): Promise<string | null>;
  discard(tokenHash: string): Promise<void>;
  deleteExpired(): Promise<void>;
}

export class D1AuthTokenRepository implements AuthTokenRepository {
  private readonly database: D1Database;
  constructor(database: D1Database) { this.database = database; }

  async issue(input: { id: string; userId: string; purpose: AuthTokenPurpose; tokenHash: string; expiresAt: string; replaceActive?: boolean }): Promise<boolean> {
    try {
      const result = await this.database.batch([
        this.database.prepare("UPDATE auth_email_tokens SET consumed_at = CURRENT_TIMESTAMP WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL AND (? = 1 OR expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now') OR created_at <= datetime('now', '-10 minutes'))").bind(input.userId, input.purpose, input.replaceActive === true ? 1 : 0),
        this.database.prepare('INSERT INTO auth_email_tokens (id, user_id, purpose, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)').bind(input.id, input.userId, input.purpose, input.tokenHash, input.expiresAt),
      ]);
      return result[1].meta.changes === 1;
    } catch (cause) {
      if (isUniqueConstraintError(cause)) return false;
      throw new DatabaseError({ operation: 'issueAuthToken', cause });
    }
  }

  async consume(tokenHash: string, purpose: AuthTokenPurpose): Promise<string | null> {
    try {
      const row = await this.database.prepare(
        `UPDATE auth_email_tokens
         SET consumed_at = CURRENT_TIMESTAMP
         WHERE token_hash = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         RETURNING user_id`,
      ).bind(tokenHash, purpose).first<{ user_id: string }>();
      return row?.user_id ?? null;
    } catch (cause) {
      throw new DatabaseError({ operation: 'consumeAuthToken', cause });
    }
  }
  async discard(tokenHash: string): Promise<void> {
    try { await this.database.prepare('DELETE FROM auth_email_tokens WHERE token_hash = ? AND consumed_at IS NULL').bind(tokenHash).run(); } catch (cause) { throw new DatabaseError({ operation: 'discardAuthToken', cause }); }
  }
  async deleteExpired(): Promise<void> {
    try { await this.database.prepare("DELETE FROM auth_email_tokens WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now') OR (consumed_at IS NOT NULL AND consumed_at <= datetime('now', '-7 days'))").run(); } catch (cause) { throw new DatabaseError({ operation: 'deleteExpiredAuthTokens', cause }); }
  }
}
