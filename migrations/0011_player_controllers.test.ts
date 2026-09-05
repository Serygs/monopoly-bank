import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('0011 player controller migration', () => {
  it('creates bounded controller ownership and backfills legacy member wallets', async () => {
    const sql = await readFile(new URL('./0011_player_controllers.sql', import.meta.url), 'utf8');

    expect(sql).toContain('CREATE TABLE player_controllers');
    expect(sql).toContain("CHECK (controller_kind IN ('PRIMARY', 'LOCAL'))");
    expect(sql).toContain('PRIMARY KEY (game_id, player_id)');
    expect(sql).toContain('UNIQUE (game_id, user_id, controller_kind)');
    expect(sql).toContain("SELECT game_id, player_id, user_id, 'PRIMARY'");
    expect(sql).toContain('ON CONFLICT(game_id, player_id) DO NOTHING');
  });
});
