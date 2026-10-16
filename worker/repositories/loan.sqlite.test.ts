// @vitest-environment node
import { readdir, readFile } from 'node:fs/promises';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  declareBankruptcy,
  issueLoan,
  repayLoan,
  reverseTransaction,
  type BankingOperationResult,
} from '../../shared/domain/banking.js';
import { defaultGameRules, type Game, type Player } from '../../shared/types/monopoly.js';
import { D1BankingOperationRepository } from './banking-operation-repository.js';
import { D1GameRepository } from './game-repository.js';
import { D1GameStatisticsRepository } from './game-statistics-repository.js';
import { D1LoanRepository } from './loan-repository.js';
import { D1PaymentRequestRepository } from './payment-request-repository.js';
import { D1TransactionRepository } from './transaction-repository.js';

/** The slice of D1 the repositories use, backed by a real SQLite database. */
function d1(database: DatabaseSync): D1Database {
  const prepare = (sql: string) => {
    let values: SQLInputValue[] = [];
    const statement = {
      bind: (...next: unknown[]) => {
        values = next as SQLInputValue[];
        return statement;
      },
      first: async () => (database.prepare(sql).get(...values) as unknown) ?? null,
      all: async () => ({ results: database.prepare(sql).all(...values) as unknown[] }),
      run: async () => {
        const result = database.prepare(sql).run(...values);
        return { meta: { changes: Number(result.changes) } };
      },
    };
    return statement;
  };
  // D1 runs a batch as one transaction: either every statement applies or none does.
  const batch = async (statements: { run: () => Promise<unknown> }[]) => {
    database.exec('BEGIN');
    try {
      const results: unknown[] = [];
      for (const statement of statements) results.push(await statement.run());
      database.exec('COMMIT');
      return results;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  };
  return { prepare, batch } as unknown as D1Database;
}

async function migrated(): Promise<DatabaseSync> {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  const directory = new URL('../../migrations/', import.meta.url);
  const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  for (const name of files) database.exec(await readFile(new URL(name, directory), 'utf8'));
  return database;
}

const game: Game = {
  id: 'game',
  name: 'Loans',
  startingBalance: 1500,
  passGoReward: 200,
  currency: 'K',
  paymentMode: 'FAST',
  rules: { ...defaultGameRules, playerLoans: true },
  settings: null,
  status: 'ACTIVE',
  createdAt: '',
  updatedAt: '',
  startedAt: '2026-01-01T00:00:00.000Z',
  finishedAt: null,
};

describe('persisted player loans', () => {
  let database: DatabaseSync;
  let operations: D1BankingOperationRepository;
  let paymentRequests: D1PaymentRequestRepository;
  let loans: D1LoanRepository;
  let transactions: D1TransactionRepository;

  beforeEach(async () => {
    database = await migrated();
    database.exec(
      `INSERT INTO games (id, name, starting_balance, pass_go_reward, currency, status, payment_mode)
       VALUES ('game', 'Loans', 1500, 200, 'K', 'ACTIVE', 'FAST');
       INSERT INTO players (id, game_id, name, color, balance) VALUES
         ('a', 'game', 'Ada', '#111111', 1500), ('b', 'game', 'Bo', '#222222', 1500),
         ('c', 'game', 'Cy', '#333333', 1500)`,
    );
    const db = d1(database);
    operations = new D1BankingOperationRepository(db);
    paymentRequests = new D1PaymentRequestRepository(db);
    loans = new D1LoanRepository(db);
    transactions = new D1TransactionRepository(db);
  });

  const players = (): Player[] =>
    (
      database.prepare('SELECT id, balance, status FROM players ORDER BY id').all() as {
        id: string;
        balance: number;
        status: Player['status'];
      }[]
    ).map((row) => ({
      id: row.id,
      gameId: 'game',
      name: row.id,
      color: '#000',
      balance: row.balance,
      status: row.status,
      createdAt: '',
    }));

  const balances = () =>
    (database.prepare('SELECT id, balance FROM players ORDER BY id').all() as unknown[]).map(
      (row) => Object.values(row as object),
    );

  const persist = (id: string, result: BankingOperationResult) =>
    operations.persist({
      transactionId: id,
      transaction: result.transaction,
      balanceChanges: result.affectedPlayers,
    });

  /** A loan is issued only by accepting a LOAN payment request, as the service does. */
  async function lend(id: string, lender: string, borrower: string, amount: number) {
    const requestId = `req-${id}`;
    await paymentRequests.create({
      id: requestId,
      kind: 'LOAN',
      gameId: 'game',
      payerPlayerId: lender,
      recipientPlayerId: borrower,
      creatorPlayerId: borrower,
      approverPlayerId: lender,
      amount,
      comment: null,
      state: 'PENDING',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const result = issueLoan({
      game,
      players: players(),
      lenderPlayerId: lender,
      borrowerPlayerId: borrower,
      amount,
    });
    await paymentRequests.settle({
      requestId,
      transactionId: id,
      transaction: result.transaction,
      balanceChanges: result.affectedPlayers,
    });
  }

  async function repay(id: string, loanId: string, playerId: string, amount: number) {
    const loan = await loans.getActive('game', loanId);
    if (loan === null) throw new Error('loan is not active');
    await persist(id, repayLoan({ game, players: players(), playerId, loan, amount }));
  }

  const loanRow = (id: string) =>
    database
      .prepare('SELECT state, repaid_amount AS repaid, closed_at AS closed FROM loans WHERE id = ?')
      .get(id) as { state: string; repaid: number; closed: string | null };

  it('rolls the whole issue back when the request expired before it was settled', async () => {
    await paymentRequests.create({
      id: 'req-late',
      kind: 'LOAN',
      gameId: 'game',
      payerPlayerId: 'a',
      recipientPlayerId: 'b',
      creatorPlayerId: 'b',
      approverPlayerId: 'a',
      amount: 400,
      comment: null,
      state: 'PENDING',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const before = balances();
    const result = issueLoan({
      game,
      players: players(),
      lenderPlayerId: 'a',
      borrowerPlayerId: 'b',
      amount: 400,
    });

    await expect(
      paymentRequests.settle({
        requestId: 'req-late',
        transactionId: 'l-late',
        transaction: result.transaction,
        balanceChanges: result.affectedPlayers,
      }),
    ).rejects.toThrow();

    expect(balances()).toEqual(before);
    expect(await transactions.getById('game', 'l-late')).toBeNull();
    expect(await loans.listActive('game')).toEqual([]);
  });

  it('stores the request kind and issues the loan when the request is accepted', async () => {
    await lend('l1', 'a', 'b', 400);

    expect(balances()).toEqual([
      ['a', 1100],
      ['b', 1900],
      ['c', 1500],
    ]);
    expect(await loans.listActive('game')).toEqual([
      expect.objectContaining({
        id: 'l1',
        lenderKind: 'PLAYER',
        lenderPlayerId: 'a',
        borrowerPlayerId: 'b',
        principal: 400,
        repaidAmount: 0,
        state: 'ACTIVE',
        closedAt: null,
      }),
    ]);
    expect(await transactions.getById('game', 'l1')).toMatchObject({
      type: 'LOAN_ISSUE',
      amount: 400,
      comment: null,
    });
    expect(await paymentRequests.getById('game', 'req-l1')).toMatchObject({
      kind: 'LOAN',
      state: 'ACCEPTED',
      transactionId: 'l1',
    });
  });

  it('lowers the debt on a partial repayment and closes the loan on the last one', async () => {
    await lend('l1', 'a', 'b', 400);
    await repay('r1', 'l1', 'b', 150);

    expect(balances()).toEqual([
      ['a', 1250],
      ['b', 1750],
      ['c', 1500],
    ]);
    expect(await loans.getActive('game', 'l1')).toMatchObject({
      repaidAmount: 150,
      state: 'ACTIVE',
    });
    expect(loanRow('l1').closed).toBeNull();

    await repay('r2', 'l1', 'b', 250);

    expect(await loans.listActive('game')).toEqual([]);
    expect(loanRow('l1')).toMatchObject({ state: 'REPAID', repaid: 400 });
    expect(loanRow('l1').closed).not.toBeNull();
    expect(
      database.prepare('SELECT transaction_id AS id, amount FROM loan_repayments ORDER BY 1').all(),
    ).toEqual([
      { id: 'r1', amount: 150 },
      { id: 'r2', amount: 250 },
    ]);
    expect(await transactions.getById('game', 'r2')).toMatchObject({ type: 'LOAN_REPAYMENT' });
  });

  it('rolls back a repayment of more than is owed', async () => {
    await lend('l1', 'a', 'b', 400);
    await repay('r1', 'l1', 'b', 300);
    const before = balances();
    // Prepared before r1 committed, when the whole 400 was still owed: 150 more would overpay.
    const stale = repayLoan({
      game,
      players: players(),
      playerId: 'b',
      loan: {
        id: 'l1',
        gameId: 'game',
        lenderKind: 'PLAYER',
        lenderPlayerId: 'a',
        borrowerPlayerId: 'b',
        principal: 400,
        repaidAmount: 0,
        state: 'ACTIVE',
        createdAt: '',
        closedAt: null,
      },
      amount: 150,
    });

    await expect(persist('r2', stale)).rejects.toThrow();

    expect(balances()).toEqual(before);
    expect(await transactions.getById('game', 'r2')).toBeNull();
    expect(loanRow('l1')).toMatchObject({ state: 'ACTIVE', repaid: 300 });
  });

  it('rolls back a stale repayment of a loan that was closed meanwhile', async () => {
    await lend('l1', 'a', 'b', 400);
    const active = (await loans.getActive('game', 'l1'))!;
    await repay('r1', 'l1', 'b', 400);
    const before = balances();
    const stale = repayLoan({ game, players: players(), playerId: 'b', loan: active, amount: 100 });

    await expect(persist('r2', stale)).rejects.toThrow();

    expect(balances()).toEqual(before);
    expect(await transactions.getById('game', 'r2')).toBeNull();
    expect(loanRow('l1')).toMatchObject({ state: 'REPAID', repaid: 400 });
  });

  it('rolls back a repayment when the borrower balance changed underneath it', async () => {
    await lend('l1', 'a', 'b', 400);
    const prepared = repayLoan({
      game,
      players: players(),
      playerId: 'b',
      loan: (await loans.getActive('game', 'l1'))!,
      amount: 100,
    });
    database.exec("UPDATE players SET balance = balance - 1 WHERE id = 'b'");
    const before = balances();

    await expect(persist('r1', prepared)).rejects.toThrow();

    expect(balances()).toEqual(before);
    expect(loanRow('l1')).toMatchObject({ state: 'ACTIVE', repaid: 0 });
  });

  it('writes off what a bankrupt borrower owes and keeps their other facts', async () => {
    await lend('l1', 'a', 'b', 400);
    await repay('r1', 'l1', 'b', 100);

    await bankrupt('bankrupt-1', 'b', 'c');

    expect(await loans.listActive('game')).toEqual([]);
    expect(loanRow('l1')).toMatchObject({ state: 'WRITTEN_OFF', repaid: 100 });
    expect(loanRow('l1').closed).not.toBeNull();
  });

  it("hands a bankrupt lender's loans to the creditor, who is then repaid", async () => {
    await lend('l1', 'a', 'b', 400);

    await bankrupt('bankrupt-1', 'a', 'c');

    const [moved] = await loans.listActive('game');
    expect(moved).toMatchObject({ id: 'l1', lenderPlayerId: 'c', borrowerPlayerId: 'b' });
    await repay('r1', 'l1', 'b', 100);
    expect(balances().find(([id]) => id === 'c')).toEqual(['c', 2700]);
  });

  it('writes off a loan whose borrower is the creditor, and all loans when bankrupt to the bank', async () => {
    await lend('l1', 'a', 'b', 400);
    await lend('l2', 'a', 'c', 100);

    await bankrupt('bankrupt-1', 'a', 'b');

    expect(loanRow('l1')).toMatchObject({ state: 'WRITTEN_OFF' });
    expect(await loans.listActive('game')).toEqual([
      expect.objectContaining({ id: 'l2', lenderPlayerId: 'b', borrowerPlayerId: 'c' }),
    ]);

    await bankrupt('bankrupt-2', 'b');

    expect(await loans.listActive('game')).toEqual([]);
    expect(loanRow('l2')).toMatchObject({ state: 'WRITTEN_OFF' });
  });

  async function bankrupt(id: string, playerId: string, creditorPlayerId?: string) {
    const result = declareBankruptcy({
      game,
      players: players(),
      playerId,
      ...(creditorPlayerId === undefined ? {} : { creditorPlayerId }),
    });
    await operations.persist({
      transactionId: id,
      transaction: result.transaction,
      balanceChanges: result.affectedPlayers,
      bankruptPlayerId: playerId,
      loanHeirPlayerId: creditorPlayerId ?? null,
    });
  }

  it('cannot be reversed', async () => {
    await lend('l1', 'a', 'b', 400);
    await repay('r1', 'l1', 'b', 100);
    for (const id of ['l1', 'r1']) {
      const original = (await transactions.getById('game', id))!;
      expect(() => reverseTransaction({ game, players: players(), original })).toThrow();
    }
  });

  it('keeps loans out of sent and received totals', async () => {
    await lend('l1', 'a', 'b', 400);
    await repay('r1', 'l1', 'b', 100);

    const summary = await new D1GameStatisticsRepository(d1(database)).calculate(game, players());

    expect(summary.totalMoneyTransferred).toBe(500);
    expect(summary.playerToPlayerTotal).toBe(0);
    expect(summary.paidToBank).toBe(0);
    expect(summary.receivedFromBank).toBe(0);
    for (const entry of summary.cashLeaderboard) {
      expect(entry.sent).toBe(0);
      expect(entry.received).toBe(0);
    }
  });

  it('still deletes a game, and purges an expired one, that holds loans', async () => {
    const games = new D1GameRepository(d1(database));
    await lend('l1', 'a', 'b', 400);
    await lend('l2', 'b', 'c', 100);
    await repay('r1', 'l1', 'b', 400);

    expect(await games.softDelete('game')).toBe(true);
    database.exec(
      "UPDATE games SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-31 days') WHERE id = 'game'",
    );
    await games.purgeExpiredDeleted();

    for (const table of ['loans', 'loan_repayments', 'transactions', 'payment_requests', 'players'])
      expect(
        (database.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number })
          .total,
      ).toBe(0);
  });
});
