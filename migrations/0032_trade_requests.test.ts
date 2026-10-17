// @vitest-environment node
import { readdir, readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const directory = new URL('./', import.meta.url);

async function database(): Promise<DatabaseSync> {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  for (const name of files) {
    db.exec('BEGIN');
    db.exec(await readFile(new URL(name, directory), 'utf8'));
    db.exec('COMMIT');
  }
  db.exec(`
    INSERT INTO games (id, name, starting_balance, pass_go_reward, currency, status, payment_mode)
      VALUES ('game', 'Trade', 1500, 200, 'K', 'ACTIVE', 'FAST');
    INSERT INTO players (id, game_id, name, color, balance) VALUES
      ('a', 'game', 'a', '#111111', 1500), ('b', 'game', 'b', '#222222', 1500);`);
  return db;
}

interface Row {
  id?: string;
  proposer?: string;
  counterparty?: string;
  give?: string;
  take?: string;
  cashGive?: number;
  cashTake?: number;
  state?: string;
  resolvedAt?: string | null;
  transactionId?: string | null;
}

function insert(db: DatabaseSync, row: Row = {}): void {
  const state = row.state ?? 'PENDING';
  db.prepare(
    `INSERT INTO trade_requests (id, game_id, proposer_player_id, counterparty_player_id,
       give_tile_ids, take_tile_ids, cash_give, cash_take, state, expires_at, resolved_at, transaction_id)
     VALUES (?, 'game', ?, ?, ?, ?, ?, ?, ?, '2099-01-01T00:00:00.000Z', ?, ?)`,
  ).run(
    row.id ?? 't1',
    row.proposer ?? 'a',
    row.counterparty ?? 'b',
    row.give ?? '["zhitna"]',
    row.take ?? '[]',
    row.cashGive ?? 0,
    row.cashTake ?? 0,
    state,
    row.resolvedAt === undefined ? (state === 'PENDING' ? null : '2099-01-01') : row.resolvedAt,
    row.transactionId === undefined ? null : row.transactionId,
  );
}

describe('0032 trade requests migration', () => {
  it('accepts a valid pending request and a cash-only one', async () => {
    const db = await database();
    expect(() => insert(db)).not.toThrow();
    expect(() => insert(db, { id: 't2', give: '[]', cashGive: 50 })).not.toThrow();
  });

  it('rejects malformed tile lists', async () => {
    const db = await database();
    expect(() => insert(db, { give: 'nope' })).toThrow(/CHECK constraint failed/);
    expect(() => insert(db, { take: '{"a":1}' })).toThrow(/CHECK constraint failed/);
  });

  it('rejects negative cash, self trades and empty trades', async () => {
    const db = await database();
    expect(() => insert(db, { cashGive: -1 })).toThrow(/CHECK constraint failed/);
    expect(() => insert(db, { cashTake: -1 })).toThrow(/CHECK constraint failed/);
    expect(() => insert(db, { counterparty: 'a' })).toThrow(/CHECK constraint failed/);
    expect(() => insert(db, { give: '[]', take: '[]' })).toThrow(/CHECK constraint failed/);
  });

  it('rejects an unknown state and inconsistent resolution fields', async () => {
    const db = await database();
    expect(() => insert(db, { state: 'DONE', resolvedAt: 'x' })).toThrow(/CHECK constraint failed/);
    expect(() => insert(db, { resolvedAt: '2099-01-01' })).toThrow(/CHECK constraint failed/);
    expect(() => insert(db, { state: 'DECLINED', resolvedAt: null })).toThrow(
      /CHECK constraint failed/,
    );
    expect(() => insert(db, { state: 'ACCEPTED' })).toThrow(/CHECK constraint failed/);
    expect(() => insert(db, { state: 'DECLINED', transactionId: 'x' })).toThrow(
      /CHECK constraint failed/,
    );
  });

  it('links an accepted request to its transaction exactly once', async () => {
    const db = await database();
    db.exec(`INSERT INTO transactions (id, game_id, type, amount, total_amount, initiator_player_id)
      VALUES ('tx', 'game', 'PROPERTY_TRANSFER', 0, 0, 'a'), ('tx2', 'game', 'PROPERTY_TRANSFER', 0, 0, 'a')`);
    expect(() => insert(db, { state: 'ACCEPTED', transactionId: 'tx' })).not.toThrow();
    expect(() => insert(db, { id: 't2', state: 'ACCEPTED', transactionId: 'tx' })).toThrow(
      /UNIQUE/,
    );
    expect(() => insert(db, { id: 't3', state: 'ACCEPTED', transactionId: 'ghost' })).toThrow(
      /FOREIGN KEY/,
    );
  });

  it('rejects players outside the game', async () => {
    const db = await database();
    expect(() => insert(db, { proposer: 'ghost' })).toThrow(/FOREIGN KEY/);
    expect(() => insert(db, { counterparty: 'ghost' })).toThrow(/FOREIGN KEY/);
  });

  it('is removed when the game is deleted', async () => {
    const db = await database();
    insert(db);
    db.exec("DELETE FROM games WHERE id = 'game'");
    expect(db.prepare('SELECT COUNT(*) AS n FROM trade_requests').get()).toEqual({ n: 0 });
  });
});
