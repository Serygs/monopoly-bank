import { DatabaseError } from '../services/errors.js';

export interface SecurityRateLimitRepository {
  take(bucket: string, limit: number, windowSeconds: number): Promise<boolean>;
  /**
   * Counts one failed attempt in `bucket` without deciding anything; pair with `isExceeded`, which
   * reads the count without adding to it (a lockout that lasts until the window ends).
   */
  recordFailure(bucket: string, windowSeconds: number): Promise<void>;
  /** True when `bucket` already holds `limit` failures inside its current window. */
  isExceeded(bucket: string, limit: number, windowSeconds: number): Promise<boolean>;
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
  async recordFailure(bucket: string, windowSeconds: number): Promise<void> {
    await this.take(bucket, Number.MAX_SAFE_INTEGER, windowSeconds);
  }
  async isExceeded(bucket: string, limit: number, windowSeconds: number): Promise<boolean> {
    try {
      const row = await this.database
        .prepare(
          `SELECT count FROM security_rate_limits
        WHERE bucket = ? AND window_started_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)`,
        )
        .bind(bucket, `-${windowSeconds} seconds`)
        .first<{ count: number }>();
      return row !== null && row.count >= limit;
    } catch (cause) {
      throw new DatabaseError({ operation: 'readSecurityRateLimit', cause });
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
