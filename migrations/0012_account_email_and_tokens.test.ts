import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('0012 account email and token migration', () => {
  it('keeps existing accounts registered and stores only bounded, consumable token state', async () => {
    const sql = await readFile(
      new URL('./0012_account_email_and_tokens.sql', import.meta.url),
      'utf8',
    );

    expect(sql).toContain("account_type TEXT NOT NULL DEFAULT 'REGISTERED'");
    expect(sql).toContain('CREATE UNIQUE INDEX users_by_normalized_email');
    expect(sql).toContain('token_hash TEXT NOT NULL UNIQUE');
    expect(sql).toContain('expires_at TEXT NOT NULL');
    expect(sql).toContain('consumed_at TEXT');
    expect(sql).toContain('auth_email_tokens_active_by_user_purpose');
  });
});
