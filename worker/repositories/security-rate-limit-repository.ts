import { DatabaseError } from '../services/errors.js';

export interface SecurityRateLimitRepository {
  take(bucket: string, limit: number, windowSeconds: number): Promise<boolean>;
  cleanup(): Promise<void>;
}

export class D1SecurityRateLimitRepository implements SecurityRateLimitRepository {
  private readonly database: D1Database;
  constructor(database: D1Database) {
    this.database = database;
  }
  async take(bucket: string, limit: number, windowSeconds: number): Promise<boolean> {
    try {
      const row = await this.database
        .prepare(
          `INSERT INTO security_rate_limits (bucket, window_started_at, count)
        VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1)
        ON CONFLICT(bucket) DO UPDATE SET
          count = CASE WHEN security_rate_limits.window_started_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?) THEN 1 ELSE security_rate_limits.count + 1 END,
          window_started_at = CASE WHEN security_rate_limits.window_started_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?) THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE security_rate_limits.window_started_at END
        RETURNING count`,
        )
        .bind(bucket, `-${windowSeconds} seconds`, `-${windowSeconds} seconds`)
        .first<{ count: number }>();
      return row !== null && row.count <= limit;
    } catch (cause) {
      throw new DatabaseError({ operation: 'takeSecurityRateLimit', cause });
    }
  }
  async cleanup(): Promise<void> {
    try {
      await this.database
        .prepare(
          "DELETE FROM security_rate_limits WHERE window_started_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days')",
        )
        .run();
    } catch (cause) {
      throw new DatabaseError({ operation: 'cleanupSecurityRateLimits', cause });
    }
  }
}
