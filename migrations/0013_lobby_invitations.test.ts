import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('lobby invitation migration', () => {
  it('adds unlisted visibility, short codes, revocation and active lookup indexes additively', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'migrations/0013_lobby_invitations.sql'),
      'utf8',
    );
    expect(sql).toMatch(/ADD COLUMN short_code/i);
    expect(sql).toMatch(/DEFAULT 'UNLISTED'/i);
    expect(sql).toMatch(/ADD COLUMN revoked_at/i);
    expect(sql).toMatch(/game_invitations_by_short_code/i);
  });
});
