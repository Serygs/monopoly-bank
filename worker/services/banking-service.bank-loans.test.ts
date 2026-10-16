import { describe, expect, it, vi } from 'vitest';
import type { Game, Loan, Player, Transaction } from '../../shared/types/monopoly.js';
import { defaultGameRules } from '../../shared/types/monopoly.js';
import { DefaultBankingService } from './banking-service.js';
import { DatabaseError } from './errors.js';

const aId = '11111111-1111-4111-8111-111111111111';
const bId = '22222222-2222-4222-8222-222222222222';
const loanId = '44444444-4444-4444-8444-444444444444';

const game: Game = {
  id: 'game',
  name: 'Table',
  startingBalance: 1500,
  passGoReward: 200,
  currency: 'K',
  paymentMode: 'FAST',
  rules: { ...defaultGameRules, bankLoans: true },
  settings: null, // derived on the fly: unit 10, so the bank lends at most 200
  status: 'ACTIVE',
  createdAt: '',
  updatedAt: '',
};

const player = (id: string, balance: number, status: Player['status'] = 'ACTIVE'): Player => ({
  id,
  gameId: 'game',
  name: id,
  color: '#000',
  balance,
  status,
  createdAt: '',
});

const bankLoan: Loan = {
  id: loanId,
  gameId: 'game',
  lenderKind: 'BANK',
  lenderPlayerId: null,
  borrowerPlayerId: bId,
  principal: 200,
  repaidAmount: 0,
  state: 'ACTIVE',
  createdAt: '',
  closedAt: null,
};

let counter = 0;
const tx = (
  type: Transaction['type'],
  deltas: Record<string, number>,
  id?: string,
): Transaction => {
  counter += 1;
  return {
    id: id ?? `tx-${counter}`,
    gameId: 'game',
    type,
    amount: 1,
    totalAmount: 1,
    comment: null,
    createdAt: '',
    participants: Object.entries(deltas).map(([playerId, balanceDelta]) => ({
      playerId,
      balanceDelta,
    })),
  };
};
const pays = (playerId: string) => tx('PLAYER_TO_BANK', { [playerId]: -1 });

/** b's turns after borrowing: `turns` extra turn starts (a acts, then b acts). */
function logAfterBorrowing(turns: number): Transaction[] {
  const log = [tx('LOAN_ISSUE', { [bId]: 200 }, loanId), pays(bId)];
  for (let turn = 0; turn < turns; turn += 1) log.push(pays(aId), pays(bId));
  return log;
}

function setup(
  options: {
    game?: Game;
    aBalance?: number;
    bBalance?: number;
    /** Active loans; a function is evaluated on every read (to model a race). */
    active?: Loan[] | (() => Loan[]);
    bankRepayments?: { playerId: string; transactionId: string }[];
    log?: Transaction[];
    persistError?: Error;
  } = {},
) {
  const table = options.game ?? game;
  let persistedType: string | null = null;
  const persist = vi.fn(async (input: unknown) => {
    if (options.persistError !== undefined) throw options.persistError;
    persistedType = (input as { transaction: { type: string } }).transaction.type;
  });
  const active = (): Loan[] =>
    typeof options.active === 'function' ? options.active() : (options.active ?? []);
  const listChronologicalSince = vi.fn(async () => options.log ?? []);
  const banking = new DefaultBankingService({
    games: { getById: async () => table } as never,
    players: {
      listByGameId: async () => [
        player(aId, options.aBalance ?? 1000),
        player(bId, options.bBalance ?? 500),
      ],
    } as never,
    transactions: {
      getById: async (_gameId: string, id: string) =>
        persistedType !== null && id === 'command-id'
          ? ({ id, type: persistedType } as Transaction)
          : null,
      listChronologicalSince,
    } as never,
    operations: { persist } as never,
    paymentRequests: {} as never,
    mortgages: { listActive: async () => [], getActive: async () => null } as never,
    loans: {
      listActive: async () => active(),
      getActive: async (_gameId: string, id: string) =>
        active().find((item) => item.id === id) ?? null,
      listBankLoanRepayments: async () => options.bankRepayments ?? [],
    } as never,
    createId: () => 'command-id',
  });
  return { banking, persist, listChronologicalSince };
}

const borrow = (amount: number, extra: { acknowledgeCooldown?: boolean } = {}) => ({
  type: 'LOAN_ISSUE' as const,
  lenderKind: 'BANK' as const,
  playerId: bId,
  amount,
  ...extra,
});

type Persisted = {
  transaction: {
    type: string;
    newLoan?: unknown;
    loanRepayment?: unknown;
    bankLoanSettlement?: unknown;
  };
  balanceChanges: { balanceAfter: number }[];
  recentAmount?: number;
};
const persistedInput = (persist: ReturnType<typeof setup>['persist']) =>
  persist.mock.calls[0]![0] as unknown as Persisted;

describe('borrowing from the bank', () => {
  it('pays out at once, with no payment request, and stores the bank loan with the transaction', async () => {
    const { banking, persist } = setup({ bBalance: 500 });

    const response = await banking.createTransaction('game', borrow(150));

    expect(response).not.toHaveProperty('paymentRequests');
    const input = persistedInput(persist);
    expect(input.transaction).toMatchObject({
      type: 'LOAN_ISSUE',
      participants: [{ playerId: bId, balanceDelta: 150 }],
      newLoan: {
        lenderKind: 'BANK',
        lenderPlayerId: null,
        borrowerPlayerId: bId,
        principal: 150,
        cooldownAcknowledged: false,
      },
    });
    expect(input.balanceChanges.map((change) => change.balanceAfter)).toEqual([650]);
  });

  it('carries the loans and cooldowns in the response', async () => {
    const { banking } = setup({ active: [bankLoan], log: logAfterBorrowing(1) });

    const response = await banking.createTransaction('game', {
      type: 'PLAYER_TO_BANK',
      playerId: aId,
      amount: 10,
    });

    expect(response).toMatchObject({
      loans: [
        {
          id: loanId,
          rounds: { round: 2, suggestedRatePercent: 10, overdue: false },
        },
      ],
      bankLoanCooldowns: [],
    });
  });

  it('is rejected with RULE_DISABLED unless the game enabled bank loans', async () => {
    for (const rules of [defaultGameRules, { ...defaultGameRules, playerLoans: true }]) {
      const { banking, persist } = setup({ game: { ...game, rules } });
      await expect(banking.createTransaction('game', borrow(100))).rejects.toMatchObject({
        code: 'RULE_DISABLED',
      });
      expect(persist).not.toHaveBeenCalled();
    }
  });

  it('refuses more than the bank lends, without writing', async () => {
    const { banking, persist } = setup();
    await expect(banking.createTransaction('game', borrow(210))).rejects.toMatchObject({
      status: 409,
      code: 'BANK_LOAN_LIMIT_EXCEEDED',
      details: { max: 200 },
    });
    expect(persist).not.toHaveBeenCalled();
  });

  it('answers 409 BANK_LOAN_ALREADY_ACTIVE for a second loan', async () => {
    const { banking, persist } = setup({ active: [bankLoan], log: logAfterBorrowing(0) });
    await expect(banking.createTransaction('game', borrow(100))).rejects.toMatchObject({
      status: 409,
      code: 'BANK_LOAN_ALREADY_ACTIVE',
    });
    expect(persist).not.toHaveBeenCalled();
  });

  it('reports the same conflict to the loser of a race on the unique active loan', async () => {
    // The first read (the check) finds no loan; once the other command wins, there is one.
    let reads = 0;
    const { banking } = setup({
      persistError: new DatabaseError({ operation: 'persistBankingOperation', cause: 'UNIQUE' }),
      active: () => (reads++ === 0 ? [] : [bankLoan]),
    });
    await expect(banking.createTransaction('game', borrow(100))).rejects.toMatchObject({
      status: 409,
      code: 'BANK_LOAN_ALREADY_ACTIVE',
    });
  });

  it('does not hide an unrelated database failure', async () => {
    const { banking } = setup({
      persistError: new DatabaseError({ operation: 'persistBankingOperation', cause: 'boom' }),
    });
    await expect(banking.createTransaction('game', borrow(100))).rejects.toMatchObject({
      code: 'DATABASE_ERROR',
    });
  });

  describe('in the cooldown after repaying the previous loan', () => {
    // b repaid in `repayment`, then only b acted: still 2 rounds to wait.
    const repayment = tx('LOAN_REPAYMENT', { [bId]: -200 });
    const options = {
      bankRepayments: [{ playerId: bId, transactionId: repayment.id }],
      log: [repayment, pays(bId), pays(aId), pays(bId)],
    };

    it('answers 409 BANK_LOAN_COOLDOWN with the rounds left, without writing', async () => {
      const { banking, persist } = setup(options);
      await expect(banking.createTransaction('game', borrow(100))).rejects.toMatchObject({
        status: 409,
        code: 'BANK_LOAN_COOLDOWN',
        details: { roundsLeft: 1 },
      });
      expect(persist).not.toHaveBeenCalled();
    });

    it('lets an acknowledged borrow through and stores the acknowledgement', async () => {
      const { banking, persist } = setup(options);
      await banking.createTransaction('game', borrow(100, { acknowledgeCooldown: true }));
      expect(persistedInput(persist).transaction.newLoan).toMatchObject({
        cooldownAcknowledged: true,
      });
    });

    it('is over after two more turn starts', async () => {
      const { banking, persist } = setup({
        ...options,
        log: [...options.log, pays(aId), pays(bId)],
      });
      await banking.createTransaction('game', borrow(100));
      expect(persistedInput(persist).transaction.newLoan).toMatchObject({
        cooldownAcknowledged: false,
      });
    });
  });
});

describe('repaying a bank loan', () => {
  const request = {
    type: 'LOAN_REPAYMENT' as const,
    playerId: bId,
    loanId,
    amount: 200,
    interestRatePercent: 10 as const,
  };

  it('takes the principal plus interest in one write and records the suggested rate', async () => {
    // Round 2 (b started one more turn): suggested 10%.
    const { banking, persist } = setup({ active: [bankLoan], log: logAfterBorrowing(1) });

    const response = await banking.createTransaction('game', request);

    const input = persistedInput(persist);
    expect(input.transaction).toMatchObject({
      type: 'LOAN_REPAYMENT',
      participants: [{ playerId: bId, balanceDelta: -220 }],
      loanRepayment: {
        loanId,
        lenderPlayerId: null,
        borrowerPlayerId: bId,
        amount: 200,
        interestAmount: 20,
        interestRatePercent: 10,
        suggestedRatePercent: 10,
      },
    });
    expect(input.balanceChanges.map((change) => change.balanceAfter)).toEqual([280]);
    expect(input.recentAmount).toBeUndefined();
    expect(response).toHaveProperty('loans');
    expect(response).toHaveProperty('bankLoanCooldowns');
  });

  it('lets the player pick another rate than the suggested one', async () => {
    const { banking, persist } = setup({ active: [bankLoan], log: logAfterBorrowing(3) });
    await banking.createTransaction('game', { ...request, interestRatePercent: 0 });
    expect(persistedInput(persist).transaction.loanRepayment).toMatchObject({
      interestAmount: 0,
      interestRatePercent: 0,
      suggestedRatePercent: 20,
    });
  });

  it('answers 409 BANK_LOAN_FULL_REPAYMENT_REQUIRED for a partial amount', async () => {
    const { banking, persist } = setup({ active: [bankLoan], log: logAfterBorrowing(0) });
    await expect(
      banking.createTransaction('game', { ...request, amount: 100 }),
    ).rejects.toMatchObject({ status: 409, code: 'BANK_LOAN_FULL_REPAYMENT_REQUIRED' });
    expect(persist).not.toHaveBeenCalled();
  });

  it('requires the interest rate for a bank loan', async () => {
    const { banking, persist } = setup({ active: [bankLoan], log: logAfterBorrowing(0) });
    await expect(
      banking.createTransaction('game', {
        type: 'LOAN_REPAYMENT',
        playerId: bId,
        loanId,
        amount: 200,
      }),
    ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(persist).not.toHaveBeenCalled();
  });

  it('rejects the interest rate on a player loan', async () => {
    const playerLoan: Loan = {
      ...bankLoan,
      lenderKind: 'PLAYER',
      lenderPlayerId: aId,
    };
    const { banking, persist } = setup({
      game: { ...game, rules: { ...defaultGameRules, playerLoans: true, bankLoans: true } },
      active: [playerLoan],
    });
    await expect(banking.createTransaction('game', request)).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
    });
    expect(persist).not.toHaveBeenCalled();
  });

  it('refuses when the borrower cannot cover the interest too, without writing', async () => {
    const { banking, persist } = setup({
      active: [bankLoan],
      log: logAfterBorrowing(1),
      bBalance: 210,
    });
    await expect(banking.createTransaction('game', request)).rejects.toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
      details: { requiredAmount: 220, shortfall: 10 },
    });
    expect(persist).not.toHaveBeenCalled();
  });

  it('is rejected with RULE_DISABLED when bank loans are off, whatever the loan', async () => {
    const off = setup({
      game: { ...game, rules: { ...defaultGameRules, playerLoans: true } },
      active: [bankLoan],
    });
    await expect(off.banking.createTransaction('game', request)).rejects.toMatchObject({
      code: 'RULE_DISABLED',
    });
    const neither = setup({ game: { ...game, rules: defaultGameRules }, active: [bankLoan] });
    await expect(neither.banking.createTransaction('game', request)).rejects.toMatchObject({
      code: 'RULE_DISABLED',
    });
    expect(off.persist).not.toHaveBeenCalled();
    expect(neither.persist).not.toHaveBeenCalled();
  });

  it('reports a loan that is not active', async () => {
    const { banking } = setup({ active: [] });
    await expect(banking.createTransaction('game', request)).rejects.toMatchObject({
      code: 'LOAN_NOT_FOUND',
    });
  });
});

describe('bank loans and responses', () => {
  it('every operation reports the loans and cooldowns while the rule is on, even with none', async () => {
    const { banking, listChronologicalSince } = setup();
    const response = await banking.createTransaction('game', {
      type: 'PASS_GO',
      playerId: aId,
    });

    expect(response).toMatchObject({ loans: [], bankLoanCooldowns: [] });
    expect(listChronologicalSince).not.toHaveBeenCalled();
  });

  it('keeps the earlier behaviour without the rule: loans only after loan operations', async () => {
    const { banking } = setup({ game: { ...game, rules: defaultGameRules } });
    const response = await banking.createTransaction('game', { type: 'PASS_GO', playerId: aId });
    expect(response).not.toHaveProperty('loans');
    expect(response).not.toHaveProperty('bankLoanCooldowns');
  });

  it('lists the cooldown of a player who repaid recently', async () => {
    const repayment = tx('LOAN_REPAYMENT', { [bId]: -200 });
    const { banking } = setup({
      bankRepayments: [{ playerId: bId, transactionId: repayment.id }],
      log: [repayment, pays(bId)],
    });
    const response = await banking.createTransaction('game', { type: 'PASS_GO', playerId: aId });
    expect(response).toMatchObject({ bankLoanCooldowns: [{ playerId: bId, roundsLeft: 2 }] });
  });
});

describe('bankruptcy with a bank loan', () => {
  it('lets the bank take its share first and pays the creditor the rest', async () => {
    // b: 500 cash, round 2 (10%): debt 220, creditor a gets 280.
    const { banking, persist } = setup({ active: [bankLoan], log: logAfterBorrowing(1) });

    const response = await banking.declareBankruptcy('game', {
      playerId: bId,
      creditorPlayerId: aId,
    });

    const input = persistedInput(persist);
    expect(input.transaction).toMatchObject({
      type: 'BANKRUPTCY_TRANSFER',
      participants: [
        { playerId: bId, balanceDelta: -500 },
        { playerId: aId, balanceDelta: 280 },
      ],
      bankLoanSettlement: {
        loanId,
        outcome: 'REPAID',
        paidPrincipal: 200,
        paidInterest: 20,
        suggestedRatePercent: 10,
      },
    });
    expect(response).toHaveProperty('loans');
    expect(response).toHaveProperty('bankLoanCooldowns');
  });

  it('writes the loan off when the wallet cannot cover the principal', async () => {
    const { banking, persist } = setup({
      active: [bankLoan],
      log: logAfterBorrowing(0),
      bBalance: 120,
    });
    await banking.declareBankruptcy('game', { playerId: bId, creditorPlayerId: aId });
    const input = persistedInput(persist);
    expect(input.transaction.participants).toEqual([{ playerId: bId, balanceDelta: -120 }]);
    expect(input.transaction.bankLoanSettlement).toMatchObject({
      outcome: 'WRITTEN_OFF',
      paidPrincipal: 120,
      paidInterest: 0,
    });
  });

  it('does not look at bank loans when the rule is off', async () => {
    const { banking, persist } = setup({ game: { ...game, rules: defaultGameRules } });
    await banking.declareBankruptcy('game', { playerId: bId, creditorPlayerId: aId });
    expect(persistedInput(persist).transaction.bankLoanSettlement).toBeUndefined();
  });
});
