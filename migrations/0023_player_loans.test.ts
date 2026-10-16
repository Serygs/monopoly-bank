// @vitest-environment node
import { readdir, readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';

const directory = new URL('./', import.meta.url);

async function migratedDatabase(before?: string): Promise<DatabaseSync> {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  const files = (await readdir(directory))
    .filter((name) => name.endsWith('.sql') && (before === undefined || name < before))
    .sort();
  for (const name of files) database.exec(await readFile(new URL(name, directory), 'utf8'));
  return database;
}

function seedGame(database: DatabaseSync, id = 'game'): void {
  database
    .prepare(
      `INSERT INTO games (id, name, starting_balance, pass_go_reward, currency, status, payment_mode)
       VALUES (?, 'Loans', 1500, 200, 'K', 'ACTIVE', 'FAST')`,
    )
    .run(id);
  for (const player of ['a', 'b'])
    database
      .prepare(
        `INSERT INTO players (id, game_id, name, color, balance) VALUES (?, ?, ?, '#123456', 1500)`,
      )
      .run(`${id}-${player}`, id, player);
}

function transaction(database: DatabaseSync, id: string, type: string, gameId = 'game'): void {
  database
    .prepare(
      `INSERT INTO transactions (id, game_id, type, amount, total_amount) VALUES (?, ?, ?, 100, 100)`,
    )
    .run(id, gameId, type);
}

interface LoanOptions {
  gameId?: string;
  kind?: string;
  lender?: string | null;
  borrower?: string;
  principal?: number;
  repaid?: number;
  state?: string;
  closedAt?: string | null;
}

function loan(database: DatabaseSync, id: string, options: LoanOptions = {}): void {
  const gameId = options.gameId ?? 'game';
  const kind = options.kind ?? 'PLAYER';
  transaction(database, id, 'LOAN_ISSUE', gameId);
  database
    .prepare(
      `INSERT INTO loans (id, game_id, lender_kind, lender_player_id, borrower_player_id, principal, repaid_amount, state, closed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      gameId,
      kind,
      options.lender === undefined ? (kind === 'PLAYER' ? `${gameId}-a` : null) : options.lender,
      options.borrower ?? `${gameId}-b`,
      options.principal ?? 100,
      options.repaid ?? 0,
      options.state ?? 'ACTIVE',
      options.closedAt ?? null,
    );
}

function repayment(database: DatabaseSync, id: string, loanId: string, amount = 40): void {
  transaction(database, id, 'LOAN_REPAYMENT');
  database
    .prepare(
      `INSERT INTO loan_repayments (transaction_id, game_id, loan_id, amount) VALUES (?, 'game', ?, ?)`,
    )
    .run(id, loanId, amount);
}

describe('0023 player loans migration', () => {
  let database: DatabaseSync;
  beforeEach(async () => {
    database = await migratedDatabase();
    seedGame(database);
  });

  it('defaults a payment request to the PAYMENT kind and rejects an unknown kind', () => {
    database.exec(
      `INSERT INTO payment_requests (id, game_id, payer_player_id, recipient_player_id, creator_player_id, approver_player_id, amount, state, expires_at)
       VALUES ('p1', 'game', 'game-a', 'game-b', 'game-b', 'game-a', 100, 'PENDING', '2099-01-01T00:00:00.000Z')`,
    );
    expect(database.prepare(`SELECT kind FROM payment_requests WHERE id = 'p1'`).get()).toEqual({
      kind: 'PAYMENT',
    });
    expect(() =>
      database.prepare(`UPDATE payment_requests SET kind = 'GIFT' WHERE id = 'p1'`).run(),
    ).toThrow(/CHECK constraint failed/);
    database.prepare(`UPDATE payment_requests SET kind = 'LOAN' WHERE id = 'p1'`).run();
  });

  it('stores a player loan and a bank loan linked to their issuing transactions', () => {
    loan(database, 'l1');
    loan(database, 'l2', { kind: 'BANK' });
    expect(database.prepare('SELECT * FROM loans WHERE id = ?').get('l1')).toMatchObject({
      lender_kind: 'PLAYER',
      lender_player_id: 'game-a',
      borrower_player_id: 'game-b',
      principal: 100,
      repaid_amount: 0,
      state: 'ACTIVE',
      closed_at: null,
    });
    expect(database.prepare('SELECT lender_player_id FROM loans WHERE id = ?').get('l2')).toEqual({
      lender_player_id: null,
    });
  });

  it('rejects a non-positive principal and an over- or negative repayment total', () => {
    expect(() => loan(database, 'zero', { principal: 0 })).toThrow(/CHECK constraint failed/);
    expect(() => loan(database, 'over', { repaid: 101 })).toThrow(/CHECK constraint failed/);
    expect(() => loan(database, 'neg', { repaid: -1 })).toThrow(/CHECK constraint failed/);
    loan(database, 'l1');
    expect(() =>
      database.prepare(`UPDATE loans SET repaid_amount = 101 WHERE id = 'l1'`).run(),
    ).toThrow(/CHECK constraint failed/);
  });

  it('rejects a player lending to themselves', () => {
    expect(() => loan(database, 'self', { lender: 'game-b', borrower: 'game-b' })).toThrow(
      /CHECK constraint failed/,
    );
  });

  it('requires a lender for a player loan and none for a bank loan', () => {
    expect(() => loan(database, 'nolender', { lender: null })).toThrow(/CHECK constraint failed/);
    expect(() => loan(database, 'bankwith', { kind: 'BANK', lender: 'game-a' })).toThrow(
      /CHECK constraint failed/,
    );
    expect(() => loan(database, 'badkind', { kind: 'OTHER' })).toThrow(/CHECK constraint failed/);
  });

  it('keeps REPAID in step with repaid_amount = principal, and ACTIVE with no closed_at', () => {
    expect(() =>
      loan(database, 'r1', { state: 'REPAID', repaid: 50, closedAt: '2099-01-01' }),
    ).toThrow(/CHECK constraint failed/);
    expect(() => loan(database, 'r2', { repaid: 100 })).toThrow(/CHECK constraint failed/);
    expect(() => loan(database, 'r3', { state: 'REPAID', repaid: 100 })).toThrow(
      /CHECK constraint failed/,
    );
    expect(() => loan(database, 'r4', { state: 'ACTIVE', closedAt: '2099-01-01' })).toThrow(
      /CHECK constraint failed/,
    );
    expect(() =>
      loan(database, 'r5', { state: 'REPAID', repaid: 100, closedAt: '2099-01-01' }),
    ).not.toThrow();
    expect(() =>
      loan(database, 'r6', { state: 'WRITTEN_OFF', repaid: 30, closedAt: '2099-01-01' }),
    ).not.toThrow();
    expect(() => loan(database, 'r7', { state: 'LOST' })).toThrow(/CHECK constraint failed/);
  });

  it('rejects a loan for players or a transaction of another game', () => {
    seedGame(database, 'other');
    transaction(database, 'foreign', 'LOAN_ISSUE', 'other');
    expect(() =>
      database
        .prepare(
          `INSERT INTO loans (id, game_id, lender_player_id, borrower_player_id, principal)
           VALUES ('foreign', 'game', 'game-a', 'game-b', 100)`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/);
    expect(() => loan(database, 'cross', { borrower: 'other-b' })).toThrow(
      /FOREIGN KEY constraint failed/,
    );
  });

  it('stores positive repayments linked to a loan and a transaction, once per transaction', () => {
    loan(database, 'l1');
    repayment(database, 'rp1', 'l1');
    expect(() => repayment(database, 'rp2', 'l1', 0)).toThrow(/CHECK constraint failed/);
    expect(() =>
      database
        .prepare(
          `INSERT INTO loan_repayments (transaction_id, game_id, loan_id, amount) VALUES ('rp1', 'game', 'l1', 10)`,
        )
        .run(),
    ).toThrow(/UNIQUE constraint failed/);
    expect(() => repayment(database, 'rp3', 'missing')).toThrow(/FOREIGN KEY constraint failed/);
  });

  it('deletes a whole game that holds loans, repayments, transactions and a loan request', () => {
    loan(database, 'l1');
    loan(database, 'l2', { kind: 'BANK' });
    repayment(database, 'rp1', 'l1');
    database.exec(
      `INSERT INTO payment_requests (id, game_id, payer_player_id, recipient_player_id, creator_player_id, approver_player_id, amount, state, expires_at, transaction_id, kind)
       VALUES ('p1', 'game', 'game-b', 'game-a', 'game-a', 'game-b', 100, 'ACCEPTED', '2099-01-01T00:00:00.000Z', 'l1', 'LOAN')`,
    );

    database.prepare('DELETE FROM games WHERE id = ?').run('game');

    for (const table of ['transactions', 'loans', 'loan_repayments', 'payment_requests'])
      expect(
        (database.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number })
          .total,
      ).toBe(0);
  });

  it('keeps existing payment requests as PAYMENT when upgrading', async () => {
    const legacy = await migratedDatabase('0023');
    seedGame(legacy);
    legacy.exec(
      `INSERT INTO transactions (id, game_id, type, amount, total_amount)
         VALUES ('t1', 'game', 'PLAYER_TO_PLAYER', 10, 10);
       INSERT INTO payment_requests (id, game_id, payer_player_id, recipient_player_id, creator_player_id, approver_player_id, amount, state, expires_at, transaction_id)
         VALUES ('r1', 'game', 'game-a', 'game-b', 'game-b', 'game-a', 10, 'ACCEPTED', '2099-01-01T00:00:00.000Z', 't1')`,
    );
    legacy.exec(
      `BEGIN; ${await readFile(new URL('./0023_player_loans.sql', directory), 'utf8')}; COMMIT;`,
    );
    expect(
      legacy.prepare('SELECT kind, transaction_id FROM payment_requests WHERE id = ?').get('r1'),
    ).toEqual({ kind: 'PAYMENT', transaction_id: 't1' });
    expect(legacy.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});
