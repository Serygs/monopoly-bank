// @vitest-environment node
import { readdir, readFile } from 'node:fs/promises';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  declareBankruptcy,
  issueBankLoan,
  repayBankLoan,
  type BankingOperationResult,
} from '../../shared/domain/banking.js';
import { buildGameSettings } from '../../shared/domain/game-rules.js';
import {
  defaultGameRules,
  type Game,
  type InterestRatePercent,
  type Player,
} from '../../shared/types/monopoly.js';
import { COOLDOWN_SCAN_TRANSACTIONS, loadBankLoanView } from '../services/bank-loan-view.js';
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
  name: 'Bank loans',
  startingBalance: 1500,
  passGoReward: 200,
  currency: 'K',
  paymentMode: 'FAST',
  rules: { ...defaultGameRules, bankLoans: true },
  settings: buildGameSettings(1500), // the bank lends at most 200
  status: 'ACTIVE',
  createdAt: '',
  updatedAt: '',
  startedAt: '2026-01-01T00:00:00.000Z',
  finishedAt: null,
};

describe('persisted bank loans', () => {
  let database: DatabaseSync;
  let operations: D1BankingOperationRepository;
  let loans: D1LoanRepository;
  let transactions: D1TransactionRepository;

  beforeEach(async () => {
    database = await migrated();
    database.exec(
      `INSERT INTO games (id, name, starting_balance, pass_go_reward, currency, status, payment_mode)
       VALUES ('game', 'Bank loans', 1500, 200, 'K', 'ACTIVE', 'FAST');
       INSERT INTO players (id, game_id, name, color, balance) VALUES
         ('a', 'game', 'Ada', '#111111', 1500), ('b', 'game', 'Bo', '#222222', 1500),
         ('c', 'game', 'Cy', '#333333', 1500)`,
    );
    const db = d1(database);
    operations = new D1BankingOperationRepository(db);
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

  const persist = (id: string, result: BankingOperationResult, recentAmount?: number) =>
    operations.persist({
      transactionId: id,
      transaction: result.transaction,
      balanceChanges: result.affectedPlayers,
      ...(recentAmount === undefined ? {} : { recentAmount }),
    });

  async function borrow(id: string, playerId: string, amount: number, acknowledge = false) {
    const view = await loadBankLoanView({ loans, transactions }, 'game', players());
    await persist(
      id,
      issueBankLoan({
        game,
        players: players(),
        playerId,
        amount,
        activeBankLoan: view.loans.find((loan) => loan.borrowerPlayerId === playerId) ?? null,
        cooldown: view.bankLoanCooldowns.find((item) => item.playerId === playerId) ?? null,
        acknowledgeCooldown: acknowledge,
      }),
      amount,
    );
  }

  async function repay(id: string, loanId: string, playerId: string, rate: InterestRatePercent) {
    const view = await loadBankLoanView({ loans, transactions }, 'game', players());
    const loan = view.loans.find((item) => item.id === loanId);
    if (loan?.rounds === undefined) throw new Error('loan is not active');
    await persist(
      id,
      repayBankLoan({
        game,
        players: players(),
        playerId,
        loan,
        amount: loan.principal - loan.repaidAmount,
        interestRatePercent: rate,
        suggestedRatePercent: loan.rounds.suggestedRatePercent,
      }),
    );
  }

  /** Someone pays the bank: the actor of a turn. */
  async function act(id: string, playerId: string) {
    const [player] = players().filter((candidate) => candidate.id === playerId);
    await operations.persist({
      transactionId: id,
      transaction: {
        gameId: 'game',
        type: 'PLAYER_TO_BANK',
        amount: 1,
        totalAmount: 1,
        comment: null,
        participants: [{ playerId, balanceDelta: -1 }],
      },
      balanceChanges: [
        {
          player: player!,
          balanceBefore: player!.balance,
          balanceAfter: player!.balance - 1,
          balanceDelta: -1,
        },
      ],
    });
  }

  const loanRow = (id: string) =>
    database
      .prepare(
        `SELECT lender_kind AS kind, lender_player_id AS lender, state, repaid_amount AS repaid,
                closed_at AS closed, cooldown_acknowledged AS acknowledged
         FROM loans WHERE id = ?`,
      )
      .get(id) as {
      kind: string;
      lender: string | null;
      state: string;
      repaid: number;
      closed: string | null;
      acknowledged: number;
    };

  const repaymentRows = () =>
    database
      .prepare(
        `SELECT transaction_id AS id, loan_id AS loan, amount, interest_amount AS interest,
                interest_rate_percent AS rate, suggested_rate_percent AS suggested
         FROM loan_repayments ORDER BY rowid`,
      )
      .all();

  async function bankrupt(id: string, playerId: string, creditorPlayerId?: string) {
    const view = await loadBankLoanView({ loans, transactions }, 'game', players());
    const loan = view.loans.find(
      (item) => item.lenderKind === 'BANK' && item.borrowerPlayerId === playerId,
    );
    const result = declareBankruptcy({
      game,
      players: players(),
      playerId,
      ...(creditorPlayerId === undefined ? {} : { creditorPlayerId }),
      ...(loan?.rounds === undefined
        ? {}
        : { bankLoan: { loan, suggestedRatePercent: loan.rounds.suggestedRatePercent } }),
    });
    await operations.persist({
      transactionId: id,
      transaction: result.transaction,
      balanceChanges: result.affectedPlayers,
      bankruptPlayerId: playerId,
      mortgageHeirPlayerId: creditorPlayerId ?? null,
      loanHeirPlayerId: creditorPlayerId ?? null,
    });
  }

  it('pays the borrower and stores the bank loan, the acknowledgement and the recent amount', async () => {
    await borrow('l1', 'b', 150);

    expect(balances()).toEqual([
      ['a', 1500],
      ['b', 1650],
      ['c', 1500],
    ]);
    expect(await loans.listActive('game')).toEqual([
      expect.objectContaining({
        id: 'l1',
        lenderKind: 'BANK',
        lenderPlayerId: null,
        borrowerPlayerId: 'b',
        principal: 150,
        repaidAmount: 0,
        state: 'ACTIVE',
        cooldownAcknowledged: false,
      }),
    ]);
    expect(await transactions.getById('game', 'l1')).toMatchObject({
      type: 'LOAN_ISSUE',
      amount: 150,
      participants: [{ playerId: 'b', balanceDelta: 150 }],
    });
    expect(database.prepare('SELECT amount FROM game_recent_amounts').all()).toEqual([
      { amount: 150 },
    ]);
  });

  it('allows one active bank loan per player and rolls a racing second one back', async () => {
    await borrow('l1', 'b', 150);
    const before = balances();
    // Prepared before l1 committed, so the domain saw no active loan.
    const stale = issueBankLoan({ game, players: players(), playerId: 'b', amount: 100 });

    await expect(persist('l2', stale)).rejects.toThrow();

    expect(balances()).toEqual(before);
    expect(await transactions.getById('game', 'l2')).toBeNull();
    expect(await loans.listActive('game')).toHaveLength(1);
    // Another player is unaffected, and so is a player loan.
    await borrow('l3', 'c', 100);
    expect(await loans.listActive('game')).toHaveLength(2);
  });

  it('allows a new bank loan once the previous one is repaid', async () => {
    await borrow('l1', 'b', 150);
    await repay('r1', 'l1', 'b', 0);

    await borrow('l2', 'b', 100, true);

    expect(loanRow('l1')).toMatchObject({ state: 'REPAID', acknowledged: 0 });
    expect(loanRow('l2')).toMatchObject({ state: 'ACTIVE', acknowledged: 1 });
  });

  it('repays principal plus interest in one batch and records both rates', async () => {
    await borrow('l1', 'b', 200);
    await act('t1', 'b');
    await act('t2', 'a');
    await act('t3', 'b'); // b started a second turn: round 2, suggested 10%

    await repay('r1', 'l1', 'b', 20);

    // 1500 + 200 - 1 - 1 - (200 + 40); the interest leaves the game.
    expect(balances().find(([id]) => id === 'b')).toEqual(['b', 1458]);
    expect(balances().find(([id]) => id === 'a')).toEqual(['a', 1499]);
    expect(loanRow('l1')).toMatchObject({ state: 'REPAID', repaid: 200 });
    expect(loanRow('l1').closed).not.toBeNull();
    expect(repaymentRows()).toEqual([
      { id: 'r1', loan: 'l1', amount: 200, interest: 40, rate: 20, suggested: 10 },
    ]);
    expect(await transactions.getById('game', 'r1')).toMatchObject({
      type: 'LOAN_REPAYMENT',
      amount: 240,
      totalAmount: 240,
      participants: [{ playerId: 'b', balanceDelta: -240 }],
    });
    expect(await loans.listBankLoanRepayments('game')).toEqual([
      { playerId: 'b', transactionId: 'r1' },
    ]);
  });

  it('rolls back a second repayment of the same bank loan', async () => {
    await borrow('l1', 'b', 200);
    const active = (await loans.getActive('game', 'l1'))!;
    const stale = repayBankLoan({
      game,
      players: players(),
      playerId: 'b',
      loan: active,
      amount: 200,
      interestRatePercent: 0,
      suggestedRatePercent: 0,
    });
    await persist('r1', stale);
    const before = balances();

    await expect(persist('r2', stale)).rejects.toThrow();

    expect(balances()).toEqual(before);
    expect(await transactions.getById('game', 'r2')).toBeNull();
    expect(repaymentRows()).toHaveLength(1);
  });

  it('rolls a repayment back when the borrower balance changed underneath it', async () => {
    await borrow('l1', 'b', 200);
    const prepared = repayBankLoan({
      game,
      players: players(),
      playerId: 'b',
      loan: (await loans.getActive('game', 'l1'))!,
      amount: 200,
      interestRatePercent: 10,
      suggestedRatePercent: 10,
    });
    database.exec("UPDATE players SET balance = balance - 1 WHERE id = 'b'");
    const before = balances();

    await expect(persist('r1', prepared)).rejects.toThrow();

    expect(balances()).toEqual(before);
    expect(loanRow('l1')).toMatchObject({ state: 'ACTIVE', repaid: 0 });
    expect(repaymentRows()).toEqual([]);
  });

  describe('bankruptcy', () => {
    beforeEach(async () => {
      await borrow('l1', 'b', 200);
      await act('t1', 'b');
      await act('t2', 'a');
      await act('t3', 'b'); // round 2: 10%, so the debt is 220
    });

    const setBalance = (id: string, balance: number) =>
      database.prepare('UPDATE players SET balance = ? WHERE id = ?').run(balance, id);

    it('pays the bank before a player creditor when the cash covers the debt', async () => {
      await bankrupt('x1', 'b', 'c'); // b holds 1698

      expect(balances()).toEqual([
        ['a', 1499],
        ['b', 0],
        ['c', 1500 + 1698 - 220],
      ]);
      expect(loanRow('l1')).toMatchObject({ state: 'REPAID', repaid: 200 });
      expect(repaymentRows()).toEqual([
        { id: 'x1', loan: 'l1', amount: 200, interest: 20, rate: 10, suggested: 10 },
      ]);
      expect(await loans.listActive('game')).toEqual([]);
    });

    it('gives the bank everything when the bankruptcy is to the bank', async () => {
      await bankrupt('x1', 'b');

      expect(balances().find(([id]) => id === 'c')).toEqual(['c', 1500]);
      expect(loanRow('l1')).toMatchObject({ state: 'REPAID' });
      expect(repaymentRows()).toEqual([expect.objectContaining({ amount: 200, interest: 20 })]);
    });

    it('writes the loan off, keeping what the bank took, when the cash is below the principal', async () => {
      setBalance('b', 150);

      await bankrupt('x1', 'b', 'c');

      expect(balances()).toEqual([
        ['a', 1499],
        ['b', 0],
        ['c', 1500], // the creditor gets nothing: the bank took everything
      ]);
      expect(loanRow('l1')).toMatchObject({ state: 'WRITTEN_OFF', repaid: 150 });
      expect(loanRow('l1').closed).not.toBeNull();
      expect(repaymentRows()).toEqual([
        { id: 'x1', loan: 'l1', amount: 150, interest: 0, rate: 10, suggested: 10 },
      ]);
    });

    it('counts the loan repaid when the principal is covered but not the interest', async () => {
      setBalance('b', 210);

      await bankrupt('x1', 'b', 'c');

      expect(balances().find(([id]) => id === 'c')).toEqual(['c', 1500]);
      expect(loanRow('l1')).toMatchObject({ state: 'REPAID', repaid: 200 });
      expect(repaymentRows()).toEqual([
        { id: 'x1', loan: 'l1', amount: 200, interest: 10, rate: 10, suggested: 10 },
      ]);
    });

    it('writes the loan off with no repayment row when the wallet is empty', async () => {
      setBalance('b', 0);

      await bankrupt('x1', 'b', 'c');

      expect(loanRow('l1')).toMatchObject({ state: 'WRITTEN_OFF', repaid: 0 });
      expect(repaymentRows()).toEqual([]);
      expect(await loans.listActive('game')).toEqual([]);
    });

    it('rolls the whole bankruptcy back when the loan was repaid meanwhile', async () => {
      const view = await loadBankLoanView({ loans, transactions }, 'game', players());
      const loan = view.loans[0]!;
      const prepared = declareBankruptcy({
        game,
        players: players(),
        playerId: 'b',
        creditorPlayerId: 'c',
        bankLoan: { loan, suggestedRatePercent: 10 },
      });
      await repay('r1', 'l1', 'b', 0);
      setBalance('b', 1698); // so only the loan, not the balance, stands in the way
      const before = balances();

      await expect(
        operations.persist({
          transactionId: 'x1',
          transaction: prepared.transaction,
          balanceChanges: prepared.affectedPlayers,
          bankruptPlayerId: 'b',
          loanHeirPlayerId: 'c',
        }),
      ).rejects.toThrow();

      expect(balances()).toEqual(before);
      expect(await transactions.getById('game', 'x1')).toBeNull();
      expect(loanRow('l1')).toMatchObject({ state: 'REPAID' });
      expect(repaymentRows()).toHaveLength(1);
      expect(database.prepare("SELECT status FROM players WHERE id = 'b'").get()).toEqual({
        status: 'ACTIVE',
      });
    });
  });

  it('infers rounds and the cooldown from the operations after the loan', async () => {
    await borrow('l1', 'b', 100);
    let view = await loadBankLoanView({ loans, transactions }, 'game', players());
    expect(view.loans[0]!.rounds).toEqual({ round: 1, suggestedRatePercent: 0, overdue: false });

    await act('t1', 'b');
    await act('t2', 'a');
    await act('t3', 'b');
    await act('t4', 'a');
    await act('t5', 'b');
    await act('t6', 'a');
    await act('t7', 'b');
    view = await loadBankLoanView({ loans, transactions }, 'game', players());
    expect(view.loans[0]!.rounds).toEqual({ round: 4, suggestedRatePercent: 20, overdue: true });
    expect(view.bankLoanCooldowns).toEqual([]);

    await repay('r1', 'l1', 'b', 20);
    view = await loadBankLoanView({ loans, transactions }, 'game', players());
    expect(view.loans).toEqual([]);
    expect(view.bankLoanCooldowns).toEqual([{ playerId: 'b', roundsLeft: 2 }]);

    await act('t8', 'a');
    await act('t9', 'b');
    view = await loadBankLoanView({ loans, transactions }, 'game', players());
    expect(view.bankLoanCooldowns).toEqual([{ playerId: 'b', roundsLeft: 1 }]);

    await act('t10', 'a');
    await act('t11', 'b');
    view = await loadBankLoanView({ loans, transactions }, 'game', players());
    expect(view.bankLoanCooldowns).toEqual([]);
  });

  it('treats a repayment older than the scanned window as past its cooldown', async () => {
    await borrow('l1', 'b', 100);
    await repay('r1', 'l1', 'b', 0);
    // Only player a acts afterwards, so b never starts a turn: the cooldown would never end.
    for (let index = 0; index < COOLDOWN_SCAN_TRANSACTIONS; index += 1) await act(`x${index}`, 'a');

    const view = await loadBankLoanView({ loans, transactions }, 'game', players());

    expect(view.bankLoanCooldowns).toEqual([]);
  });

  it('reads only the newest transactions when asked for a window', async () => {
    await act('t1', 'a');
    await act('t2', 'b');
    await act('t3', 'a');

    const since = await transactions.listChronologicalSince('game', ['t1'], 2);

    expect(since.map((item) => item.id)).toEqual(['t2', 't3']);
    expect(
      (await transactions.listChronologicalSince('game', ['t1'], 10)).map((item) => item.id),
    ).toEqual(['t1', 't2', 't3']);
  });

  it('does not read the log when there is nothing to track', async () => {
    const view = await loadBankLoanView({ loans, transactions }, 'game', players());
    expect(view).toEqual({ loans: [], bankLoanCooldowns: [] });
    expect(await transactions.listChronologicalSince('game', [])).toEqual([]);
  });

  it('lists transactions from the earliest anchor on, in the order they were written', async () => {
    await act('z-first', 'a');
    await borrow('l1', 'b', 100); // same second, and its id sorts before the next ones
    await act('y-second', 'c');
    await act('a-third', 'a');

    const since = await transactions.listChronologicalSince('game', ['a-third', 'l1']);

    expect(since.map((item) => item.id)).toEqual(['l1', 'y-second', 'a-third']);
    expect(since[0]!.participants).toEqual([{ playerId: 'b', balanceDelta: 100 }]);
    expect(await transactions.listChronologicalSince('other-game', ['l1'])).toEqual([]);
  });

  it('keeps bank loan transactions out of sent and received totals', async () => {
    await borrow('l1', 'b', 200);
    await repay('r1', 'l1', 'b', 0);

    const summary = await new D1GameStatisticsRepository(d1(database)).calculate(game, players());

    expect(summary.playerToPlayerTotal).toBe(0);
    expect(summary.paidToBank).toBe(0);
    expect(summary.receivedFromBank).toBe(0);
    for (const entry of summary.cashLeaderboard) {
      expect(entry.sent).toBe(0);
      expect(entry.received).toBe(0);
    }
  });

  it('still deletes a game that holds bank loans', async () => {
    await borrow('l1', 'b', 200);
    await repay('r1', 'l1', 'b', 10);
    await borrow('l2', 'c', 100);
    const games = new D1GameRepository(d1(database));

    expect(await games.softDelete('game')).toBe(true);
    database.exec(
      "UPDATE games SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-31 days') WHERE id = 'game'",
    );
    await games.purgeExpiredDeleted();

    for (const table of ['loans', 'loan_repayments', 'transactions', 'players'])
      expect(
        (database.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number })
          .total,
      ).toBe(0);
  });
});

describe('pending requests the actor created', () => {
  let database: DatabaseSync;
  let paymentRequests: D1PaymentRequestRepository;

  beforeEach(async () => {
    database = await migrated();
    database.exec(
      `INSERT INTO games (id, name, starting_balance, pass_go_reward, currency, status, payment_mode)
       VALUES ('game', 'Requests', 1500, 200, 'K', 'ACTIVE', 'CONFIRMATION');
       INSERT INTO players (id, game_id, name, color, balance) VALUES
         ('a', 'game', 'Ada', '#111111', 1500), ('b', 'game', 'Bo', '#222222', 1500),
         ('c', 'game', 'Cy', '#333333', 1500)`,
    );
    paymentRequests = new D1PaymentRequestRepository(d1(database));
  });

  const request = (
    id: string,
    creator: string,
    approver: string,
    state: 'PENDING' | 'CANCELLED',
  ) => ({
    id,
    kind: 'PAYMENT' as const,
    gameId: 'game',
    payerPlayerId: approver,
    recipientPlayerId: creator,
    creatorPlayerId: creator,
    approverPlayerId: approver,
    amount: 10,
    comment: null,
    state,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });

  it('returns the requests to answer and the ones the actor started, but no resolved ones', async () => {
    await paymentRequests.create({ ...request('to-answer', 'b', 'a', 'PENDING') });
    await paymentRequests.create({ ...request('started', 'a', 'b', 'PENDING') });
    await paymentRequests.create({ ...request('others', 'b', 'c', 'PENDING') });
    await paymentRequests.create({
      ...request('cancelled', 'a', 'b', 'CANCELLED'),
    });

    const listed = await paymentRequests.listForPayers('game', ['a']);

    expect(listed.map((item) => item.id).sort()).toEqual(['started', 'to-answer']);
    expect(listed.find((item) => item.id === 'started')).toMatchObject({
      creatorPlayerId: 'a',
      approverPlayerId: 'b',
    });
    expect(await paymentRequests.listForPayers('game', [])).toEqual([]);
  });

  it('lists a request once when the actor controls both wallets', async () => {
    await paymentRequests.create({ ...request('self', 'b', 'a', 'PENDING') });

    expect(await paymentRequests.listForPayers('game', ['a', 'b'])).toHaveLength(1);
  });
});
