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

function transaction(database: DatabaseSync, id: string, type: string): void {
  database
    .prepare(
      `INSERT INTO transactions (id, game_id, type, amount, total_amount) VALUES (?, 'game', ?, 100, 100)`,
    )
    .run(id, type);
}

interface LoanOptions {
  kind?: string;
  borrower?: string;
  state?: string;
  repaid?: number;
  closedAt?: string | null;
  acknowledged?: number;
}

function loan(database: DatabaseSync, id: string, options: LoanOptions = {}): void {
  const kind = options.kind ?? 'BANK';
  const state = options.state ?? 'ACTIVE';
  transaction(database, id, 'LOAN_ISSUE');
  database
    .prepare(
      `INSERT INTO loans (id, game_id, lender_kind, lender_player_id, borrower_player_id, principal, repaid_amount, state, closed_at, cooldown_acknowledged)
       VALUES (?, 'game', ?, ?, ?, 100, ?, ?, ?, ?)`,
    )
    .run(
      id,
      kind,
      kind === 'PLAYER' ? 'game-a' : null,
      options.borrower ?? 'game-b',
      options.repaid ?? (state === 'REPAID' ? 100 : 0),
      state,
      options.closedAt ?? (state === 'ACTIVE' ? null : '2099-01-01'),
      options.acknowledged ?? 0,
    );
}

interface RepaymentOptions {
  amount?: number;
  interest?: number;
  rate?: number | null;
  suggested?: number | null;
}

function repayment(
  database: DatabaseSync,
  id: string,
  loanId: string,
  options: RepaymentOptions = {},
): void {
  transaction(database, id, 'LOAN_REPAYMENT');
  database
    .prepare(
      `INSERT INTO loan_repayments (transaction_id, game_id, loan_id, amount, interest_amount, interest_rate_percent, suggested_rate_percent)
       VALUES (?, 'game', ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      loanId,
      options.amount ?? 100,
      options.interest ?? 0,
      options.rate === undefined ? null : options.rate,
      options.suggested === undefined ? null : options.suggested,
    );
}

describe('0024 bank loans migration', () => {
  let database: DatabaseSync;
  beforeEach(async () => {
    database = await migratedDatabase();
    seedGame(database);
  });

  it('defaults the cooldown flag to 0 and only accepts 0 or 1', () => {
    loan(database, 'l1');
    expect(
      database.prepare('SELECT cooldown_acknowledged FROM loans WHERE id = ?').get('l1'),
    ).toEqual({ cooldown_acknowledged: 0 });
    database.prepare(`UPDATE loans SET cooldown_acknowledged = 1 WHERE id = 'l1'`).run();
    expect(() => loan(database, 'l2', { borrower: 'game-a', acknowledged: 2 })).toThrow(
      /CHECK constraint failed/,
    );
    expect(() =>
      database.prepare(`UPDATE loans SET cooldown_acknowledged = -1 WHERE id = 'l1'`).run(),
    ).toThrow(/CHECK constraint failed/);
  });

  it('stores interest and the chosen and suggested rates on a repayment', () => {
    loan(database, 'l1');
    repayment(database, 'rp1', 'l1', { interest: 20, rate: 20, suggested: 10 });
    expect(
      database.prepare('SELECT * FROM loan_repayments WHERE transaction_id = ?').get('rp1'),
    ).toMatchObject({
      amount: 100,
      interest_amount: 20,
      interest_rate_percent: 20,
      suggested_rate_percent: 10,
    });
  });

  it('defaults a repayment to no interest and no rates', () => {
    loan(database, 'l1', { kind: 'PLAYER' });
    repayment(database, 'rp1', 'l1', { amount: 40 });
    expect(
      database.prepare('SELECT * FROM loan_repayments WHERE transaction_id = ?').get('rp1'),
    ).toMatchObject({
      interest_amount: 0,
      interest_rate_percent: null,
      suggested_rate_percent: null,
    });
  });

  it('rejects negative interest and rates outside 0, 10 and 20', () => {
    loan(database, 'l1');
    expect(() => repayment(database, 'rp1', 'l1', { interest: -1 })).toThrow(
      /CHECK constraint failed/,
    );
    expect(() => repayment(database, 'rp2', 'l1', { rate: 5 })).toThrow(/CHECK constraint failed/);
    expect(() => repayment(database, 'rp3', 'l1', { suggested: 30 })).toThrow(
      /CHECK constraint failed/,
    );
    expect(() => repayment(database, 'rp4', 'l1', { rate: 0, suggested: 0 })).not.toThrow();
  });

  it('allows one active bank loan per player', () => {
    loan(database, 'l1');
    expect(() => loan(database, 'l2')).toThrow(/UNIQUE constraint failed/);
    expect(() => loan(database, 'l3', { borrower: 'game-a' })).not.toThrow();
  });

  it('allows a second bank loan once the first is REPAID or WRITTEN_OFF', () => {
    loan(database, 'l1');
    database
      .prepare(
        `UPDATE loans SET state = 'REPAID', repaid_amount = principal, closed_at = '2099-01-01' WHERE id = 'l1'`,
      )
      .run();
    expect(() => loan(database, 'l2')).not.toThrow();
    expect(() => loan(database, 'l3')).toThrow(/UNIQUE constraint failed/);
    database
      .prepare(`UPDATE loans SET state = 'WRITTEN_OFF', closed_at = '2099-01-01' WHERE id = 'l2'`)
      .run();
    expect(() => loan(database, 'l4')).not.toThrow();
    expect(
      (
        database
          .prepare(`SELECT COUNT(*) AS total FROM loans WHERE borrower_player_id = 'game-b'`)
          .get() as { total: number }
      ).total,
    ).toBe(3);
  });

  it('does not limit player loans, nor let one block a bank loan', () => {
    loan(database, 'p1', { kind: 'PLAYER' });
    expect(() => loan(database, 'p2', { kind: 'PLAYER' })).not.toThrow();
    expect(() => loan(database, 'b1')).not.toThrow();
    expect(() => loan(database, 'p3', { kind: 'PLAYER' })).not.toThrow();
  });

  it('keeps existing loans and repayments with neutral values when upgrading', async () => {
    const legacy = await migratedDatabase('0024');
    seedGame(legacy);
    legacy.exec(
      `INSERT INTO transactions (id, game_id, type, amount, total_amount)
         VALUES ('l1', 'game', 'LOAN_ISSUE', 100, 100), ('rp1', 'game', 'LOAN_REPAYMENT', 40, 40);
       INSERT INTO loans (id, game_id, lender_kind, lender_player_id, borrower_player_id, principal, repaid_amount)
         VALUES ('l1', 'game', 'PLAYER', 'game-a', 'game-b', 100, 40);
       INSERT INTO loan_repayments (transaction_id, game_id, loan_id, amount)
         VALUES ('rp1', 'game', 'l1', 40)`,
    );
    legacy.exec(
      `BEGIN; ${await readFile(new URL('./0024_bank_loans.sql', directory), 'utf8')}; COMMIT;`,
    );
    expect(
      legacy
        .prepare('SELECT cooldown_acknowledged, repaid_amount FROM loans WHERE id = ?')
        .get('l1'),
    ).toEqual({ cooldown_acknowledged: 0, repaid_amount: 40 });
    expect(
      legacy
        .prepare(
          'SELECT amount, interest_amount, interest_rate_percent, suggested_rate_percent FROM loan_repayments WHERE transaction_id = ?',
        )
        .get('rp1'),
    ).toEqual({
      amount: 40,
      interest_amount: 0,
      interest_rate_percent: null,
      suggested_rate_percent: null,
    });
    expect(legacy.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});
