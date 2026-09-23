import type { AccountExport } from '../../shared/contracts/api.js';

export interface PrivacyRepository {
  exportAccount(userId: string): Promise<AccountExport>;
  hasActiveMembership(userId: string): Promise<boolean>;
  anonymizeAccount(
    userId: string,
    replacementNickname: string,
    passwordHash: string,
    passwordSalt: string,
  ): Promise<boolean>;
  cleanupExpiredGuests(): Promise<void>;
  cleanupExpiredOperationalData(): Promise<void>;
}

export class D1PrivacyRepository implements PrivacyRepository {
  private readonly database: D1Database;
  constructor(database: D1Database) {
    this.database = database;
  }
  async exportAccount(userId: string): Promise<AccountExport> {
    const profile = await this.database
      .prepare(
        'SELECT id, nickname, avatar, account_type, email, email_verified_at, created_at, updated_at FROM users WHERE id = ?',
      )
      .bind(userId)
      .first<{
        id: string;
        nickname: string;
        avatar: string;
        account_type: 'REGISTERED' | 'GUEST';
        email: string | null;
        email_verified_at: string | null;
        created_at: string;
        updated_at: string;
      }>();
    if (profile === null) throw new Error('Account does not exist.');
    const memberships = await this.database
      .prepare(
        `SELECT games.id AS game_id, games.name AS game_name, games.status AS game_status, game_members.role, game_members.player_id
      FROM game_members INNER JOIN games ON games.id = game_members.game_id WHERE game_members.user_id = ? ORDER BY games.created_at DESC`,
      )
      .bind(userId)
      .all<{
        game_id: string;
        game_name: string;
        game_status: string;
        role: 'OWNER' | 'PLAYER';
        player_id: string | null;
      }>();
    return {
      exportedAt: new Date().toISOString(),
      profile: {
        id: profile.id,
        nickname: profile.nickname,
        avatar: profile.avatar,
        accountType: profile.account_type,
        email: profile.email,
        emailVerified: profile.email_verified_at !== null,
        createdAt: profile.created_at,
        updatedAt: profile.updated_at,
      },
      memberships: memberships.results.map((item) => ({
        gameId: item.game_id,
        gameName: item.game_name,
        gameStatus: item.game_status,
        role: item.role,
        playerId: item.player_id,
      })),
    };
  }
  async hasActiveMembership(userId: string): Promise<boolean> {
    return (
      (await this.database
        .prepare(
          "SELECT 1 AS value FROM game_members INNER JOIN games ON games.id = game_members.game_id WHERE game_members.user_id = ? AND games.status IN ('LOBBY', 'ACTIVE') LIMIT 1",
        )
        .bind(userId)
        .first<{ value: number }>()) !== null
    );
  }
  async anonymizeAccount(
    userId: string,
    replacementNickname: string,
    passwordHash: string,
    passwordSalt: string,
  ): Promise<boolean> {
    const result = await this.database.batch([
      this.database.prepare('DELETE FROM user_sessions WHERE user_id = ?').bind(userId),
      this.database.prepare('DELETE FROM auth_email_tokens WHERE user_id = ?').bind(userId),
      this.database
        .prepare(
          "UPDATE users SET nickname = ?, avatar = '', email = NULL, normalized_email = NULL, email_verified_at = NULL, password_hash = ?, password_salt = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        )
        .bind(replacementNickname, passwordHash, passwordSalt, userId),
    ]);
    return result[2].meta.changes === 1;
  }
  async cleanupExpiredGuests(): Promise<void> {
    await this.database
      .prepare(
        "DELETE FROM users WHERE account_type = 'GUEST' AND created_at <= datetime('now', '-30 days') AND NOT EXISTS (SELECT 1 FROM game_members WHERE game_members.user_id = users.id)",
      )
      .run();
  }
  async cleanupExpiredOperationalData(): Promise<void> {
    await this.database.batch([
      this.database.prepare(
        "UPDATE payment_requests SET state = 'EXPIRED', resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP) WHERE state = 'PENDING' AND expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
      ),
      this.database.prepare(
        "DELETE FROM payment_requests WHERE state <> 'PENDING' AND resolved_at <= datetime('now', '-90 days')",
      ),
      this.database.prepare(
        "DELETE FROM game_invitations WHERE expires_at <= datetime('now', '-30 days') OR revoked_at <= datetime('now', '-30 days')",
      ),
      this.database.prepare(
        "DELETE FROM command_ledger WHERE status = 'COMPLETED' AND game_id IN (SELECT id FROM games WHERE status = 'FINISHED' AND finished_at <= datetime('now', '-90 days'))",
      ),
    ]);
  }
}
