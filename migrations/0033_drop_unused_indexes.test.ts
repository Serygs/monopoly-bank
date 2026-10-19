// @vitest-environment node
import { readdir, readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { beforeAll, describe, expect, it } from 'vitest';

const directory = new URL('./', import.meta.url);

async function migratedDatabase(): Promise<DatabaseSync> {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  for (const name of files) database.exec(await readFile(new URL(name, directory), 'utf8'));
  return database;
}

const dropped = [
  'transactions_by_game_id_created_id',
  'transaction_participants_by_player_id',
  'command_ledger_by_game_created',
  'game_properties_by_owner',
  'payment_requests_recipient',
  'user_sessions_by_token_hash',
  'game_invitations_by_game_id',
];

const queries: Record<string, string> = {
  'activity page': `SELECT id FROM transactions WHERE game_id = 'g' AND (created_at < 'x' OR (created_at = 'x' AND id < 'y')) ORDER BY created_at DESC, id DESC LIMIT 51`,
  'mine filter': `SELECT 1 FROM transaction_participants mine WHERE mine.transaction_id = 't' AND mine.player_id IN ('a', 'b')`,
  'player statistics': `SELECT p.id, SUM(tp.balance_delta) FROM players p LEFT JOIN transaction_participants tp ON tp.game_id = p.game_id AND tp.player_id = p.id WHERE p.game_id = 'g' GROUP BY p.id`,
  'participant of a removed player': `SELECT 1 FROM transaction_participants WHERE player_id = 'p' AND game_id = 'g'`,
  'payment request inbox': `SELECT * FROM payment_requests WHERE game_id = 'g' AND (approver_player_id IN ('a') OR creator_player_id IN ('a')) AND state = 'PENDING'`,
  'payment request expiry': `UPDATE payment_requests SET state = 'EXPIRED' WHERE game_id = 'g' AND state = 'PENDING' AND expires_at <= 'x'`,
  'payment request recipient of a removed player': `SELECT 1 FROM payment_requests WHERE recipient_player_id = 'p' AND game_id = 'g'`,
  'command ledger cleanup': `DELETE FROM command_ledger WHERE status = 'COMPLETED' AND game_id IN ('g')`,
  'tiles of a removed player': `SELECT 1 FROM game_properties WHERE owner_player_id = 'p' AND game_id = 'g'`,
  'session lookup': `SELECT user_id FROM user_sessions WHERE token_hash = 'h'`,
  'invitation revoke': `UPDATE game_invitations SET revoked_at = 'x' WHERE game_id = 'g' AND created_by_user_id = 'u' AND revoked_at IS NULL`,
};

describe('0033 drop unused indexes migration', () => {
  let database: DatabaseSync;
  beforeAll(async () => {
    database = await migratedDatabase();
  });

  it('drops every unused or duplicate index', () => {
    const names = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
      .all()
      .map((row) => (row as { name: string }).name);
    for (const name of dropped) expect(names).not.toContain(name);
    expect(names).toContain('transactions_by_game_id_created_at_id');
    expect(names).toContain('transaction_participants_by_game_player_transaction');
  });

  it.each(Object.entries(queries))('still searches an index for the %s', (_name, sql) => {
    const plan = database
      .prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .all()
      .map((row) => (row as { detail: string }).detail);
    expect(plan.some((detail) => detail.startsWith('SEARCH'))).toBe(true);
    expect(plan.filter((detail) => /^SCAN (?!CONSTANT)/.test(detail))).toEqual([]);
  });
});
