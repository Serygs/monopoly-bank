import { describe, expect, it, vi } from 'vitest';
import type { PaymentRequest } from '../../shared/contracts/api.js';
import { LoanNotFoundError } from '../../shared/domain/banking.js';
import type { Game, Loan, Player, Transaction } from '../../shared/types/monopoly.js';
import { defaultGameRules } from '../../shared/types/monopoly.js';
import { DefaultBankingService } from './banking-service.js';

const lenderId = '11111111-1111-4111-8111-111111111111';
const borrowerId = '22222222-2222-4222-8222-222222222222';
const loanId = '44444444-4444-4444-8444-444444444444';

const game: Game = {
  id: 'game',
  name: 'Table',
  startingBalance: 1500,
  passGoReward: 200,
  currency: 'K',
  paymentMode: 'FAST',
  rules: { ...defaultGameRules, playerLoans: true },
  settings: null,
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

const loan: Loan = {
  id: loanId,
  gameId: 'game',
  lenderKind: 'PLAYER',
  lenderPlayerId: lenderId,
  borrowerPlayerId: borrowerId,
  principal: 300,
  repaidAmount: 100,
  state: 'ACTIVE',
  createdAt: '',
  closedAt: null,
};

const loanRequest = {
  type: 'LOAN_ISSUE' as const,
  borrowerPlayerId: borrowerId,
  lenderPlayerId: lenderId,
  amount: 400,
};

function setup(
  options: {
    game?: Game;
    lenderBalance?: number;
    borrowerBalance?: number;
    reserved?: number;
    active?: Loan[];
    paymentRequest?: Partial<PaymentRequest>;
  } = {},
) {
  const table = options.game ?? game;
  const requests = new Map<string, PaymentRequest>();
  if (options.paymentRequest !== undefined) {
    const stored: PaymentRequest = {
      id: 'req-1',
      kind: 'LOAN',
      gameId: 'game',
      payerPlayerId: lenderId,
      recipientPlayerId: borrowerId,
      creatorPlayerId: borrowerId,
      approverPlayerId: lenderId,
      amount: 400,
      comment: null,
      state: 'PENDING',
      expiresAt: '',
      createdAt: '',
      resolvedAt: null,
      transactionId: null,
      ...options.paymentRequest,
    };
    requests.set(stored.id, stored);
  }
  let persistedType: string | null = null;
  const persist = vi.fn(async (input: unknown) => {
    persistedType = (input as { transaction: { type: string } }).transaction.type;
  });
  const settle = vi.fn(async (input: { transactionId: string; transaction: { type: string } }) => {
    persistedType = input.transaction.type;
    requests.set('req-1', {
      ...requests.get('req-1')!,
      state: 'ACCEPTED',
      transactionId: input.transactionId,
    });
  });
  const listActive = vi.fn(async () => options.active ?? []);
  const create = vi.fn(async (request: Omit<PaymentRequest, 'createdAt'>) => {
    requests.set(request.id, { ...request, createdAt: '', resolvedAt: null, transactionId: null });
  });
  const banking = new DefaultBankingService({
    games: { getById: async () => table } as never,
    players: {
      listByGameId: async () => [
        player(lenderId, options.lenderBalance ?? 1000),
        player(borrowerId, options.borrowerBalance ?? 200),
      ],
    } as never,
    transactions: {
      getById: async (_gameId: string, id: string) =>
        persistedType !== null && id === 'command-id'
          ? ({ id, type: persistedType } as Transaction)
          : null,
    } as never,
    operations: { persist } as never,
    paymentRequests: {
      create,
      getById: async (_gameId: string, id: string) => requests.get(id) ?? null,
      pendingReservedAmount: async () => options.reserved ?? 0,
      expirePending: async () => undefined,
      settle,
    } as never,
    mortgages: { listActive: async () => [], getActive: async () => null } as never,
    loans: {
      listActive,
      getActive: async (_gameId: string, id: string) =>
        (options.active ?? []).find((item) => item.id === id) ?? null,
    } as never,
    createId: () => 'command-id',
  });
  return { banking, persist, settle, create, listActive };
}

describe('asking for a loan', () => {
  it('always creates a pending LOAN request for the lender, even in fast mode, and moves nothing', async () => {
    const { banking, persist, create } = setup();
    const response = await banking.createTransaction('game', loanRequest);

    expect(persist).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledOnce();
    expect(response).toHaveProperty('paymentRequests');
    const [created] = (response as { paymentRequests: PaymentRequest[] }).paymentRequests;
    expect(created).toMatchObject({
      kind: 'LOAN',
      payerPlayerId: lenderId,
      recipientPlayerId: borrowerId,
      creatorPlayerId: borrowerId,
      approverPlayerId: lenderId,
      amount: 400,
      state: 'PENDING',
      comment: null,
    });
  });

  it('is rejected with RULE_DISABLED when the game did not enable player loans', async () => {
    const { banking, create } = setup({ game: { ...game, rules: defaultGameRules } });
    await expect(banking.createTransaction('game', loanRequest)).rejects.toMatchObject({
      code: 'RULE_DISABLED',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses a lender without enough funds', async () => {
    const { banking, create } = setup({ lenderBalance: 300 });
    await expect(banking.createTransaction('game', loanRequest)).rejects.toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('counts money already promised in pending requests against the lender', async () => {
    const { banking, create } = setup({ lenderBalance: 500, reserved: 200 });
    await expect(banking.createTransaction('game', loanRequest)).rejects.toMatchObject({
      code: 'INSUFFICIENT_AVAILABLE_FUNDS',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses lending to oneself and a finished game', async () => {
    const { banking, create } = setup();
    await expect(
      banking.createTransaction('game', { ...loanRequest, lenderPlayerId: borrowerId }),
    ).rejects.toMatchObject({ code: 'SAME_SOURCE_AND_DESTINATION' });
    const finished = setup({ game: { ...game, status: 'FINISHED' } });
    await expect(finished.banking.createTransaction('game', loanRequest)).rejects.toMatchObject({
      code: 'GAME_FINISHED',
    });
    expect(create).not.toHaveBeenCalled();
    expect(finished.create).not.toHaveBeenCalled();
  });
});

describe('accepting a loan request', () => {
  it('settles a LOAN_ISSUE with its loan record in one write and returns the loans', async () => {
    const issued: Loan = { ...loan, repaidAmount: 0, principal: 400 };
    const { banking, settle, listActive } = setup({ paymentRequest: {}, active: [issued] });

    const response = await banking.acceptPaymentRequest('game', 'req-1');

    expect(settle).toHaveBeenCalledOnce();
    const input = settle.mock.calls[0]![0] as unknown as {
      transaction: { type: string; comment: null; newLoan: unknown; participants: unknown };
      balanceChanges: { balanceAfter: number }[];
    };
    expect(input.transaction).toMatchObject({
      type: 'LOAN_ISSUE',
      comment: null,
      newLoan: { lenderPlayerId: lenderId, borrowerPlayerId: borrowerId, principal: 400 },
      participants: [
        { playerId: lenderId, balanceDelta: -400 },
        { playerId: borrowerId, balanceDelta: 400 },
      ],
    });
    expect(input.balanceChanges.map((change) => change.balanceAfter)).toEqual([600, 600]);
    expect(listActive).toHaveBeenCalled();
    expect(response.loans).toEqual([issued]);
    expect(response.paymentRequest.state).toBe('ACCEPTED');
  });

  it('does not settle when the rule is disabled or the lender can no longer afford it', async () => {
    const disabled = setup({
      game: { ...game, rules: defaultGameRules },
      paymentRequest: {},
    });
    await expect(disabled.banking.acceptPaymentRequest('game', 'req-1')).rejects.toMatchObject({
      code: 'RULE_DISABLED',
    });
    const poor = setup({ paymentRequest: {}, lenderBalance: 100 });
    await expect(poor.banking.acceptPaymentRequest('game', 'req-1')).rejects.toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
    });
    expect(disabled.settle).not.toHaveBeenCalled();
    expect(poor.settle).not.toHaveBeenCalled();
  });

  it('settles an ordinary request without loans', async () => {
    const { banking, settle } = setup({ paymentRequest: { kind: 'PAYMENT' } });
    const response = await banking.acceptPaymentRequest('game', 'req-1');
    expect(
      (settle.mock.calls[0]![0] as unknown as { transaction: { type: string } }).transaction.type,
    ).toBe('PLAYER_TO_PLAYER');
    expect(response.loans).toBeUndefined();
  });
});

describe('repaying a loan', () => {
  const request = { type: 'LOAN_REPAYMENT' as const, playerId: borrowerId, loanId, amount: 150 };

  it('pays the lender, names the loan in the same write and returns the loans', async () => {
    const { banking, persist, listActive } = setup({ active: [loan] });
    const response = await banking.createTransaction('game', request);

    const input = persist.mock.calls[0]![0] as {
      transaction: { type: string; loanRepayment: unknown };
      balanceChanges: { balanceAfter: number }[];
      recentAmount?: number;
    };
    expect(input.transaction).toMatchObject({
      type: 'LOAN_REPAYMENT',
      loanRepayment: {
        loanId,
        lenderPlayerId: lenderId,
        borrowerPlayerId: borrowerId,
        amount: 150,
      },
    });
    expect(input.balanceChanges.map((change) => change.balanceAfter)).toEqual([50, 1150]);
    expect(input.recentAmount).toBeUndefined();
    expect(listActive).toHaveBeenCalled();
    expect(response).toHaveProperty('loans');
  });

  it('reports a loan that is missing, closed or someone elses without writing', async () => {
    const missing = setup({ active: [] });
    await expect(missing.banking.createTransaction('game', request)).rejects.toBeInstanceOf(
      LoanNotFoundError,
    );
    const other = setup({ active: [{ ...loan, borrowerPlayerId: lenderId }] });
    await expect(other.banking.createTransaction('game', request)).rejects.toMatchObject({
      code: 'LOAN_NOT_FOUND',
    });
    expect(missing.persist).not.toHaveBeenCalled();
    expect(other.persist).not.toHaveBeenCalled();
  });

  it('refuses more than is owed and more than the borrower has, without writing', async () => {
    const over = setup({ active: [loan] });
    await expect(
      over.banking.createTransaction('game', { ...request, amount: 201 }),
    ).rejects.toMatchObject({ code: 'LOAN_AMOUNT_EXCEEDS_DEBT' });
    const poor = setup({ active: [loan], borrowerBalance: 100 });
    await expect(poor.banking.createTransaction('game', request)).rejects.toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
    });
    expect(over.persist).not.toHaveBeenCalled();
    expect(poor.persist).not.toHaveBeenCalled();
  });

  it('is rejected with RULE_DISABLED when the game did not enable player loans', async () => {
    const { banking, persist } = setup({
      game: { ...game, rules: defaultGameRules },
      active: [loan],
    });
    await expect(banking.createTransaction('game', request)).rejects.toMatchObject({
      code: 'RULE_DISABLED',
    });
    expect(persist).not.toHaveBeenCalled();
  });

  it('leaves the loan list out of the response of an unrelated operation', async () => {
    const { banking, persist } = setup({ active: [loan] });
    const response = await banking.createTransaction('game', {
      type: 'PLAYER_TO_BANK',
      playerId: lenderId,
      amount: 10,
    });
    expect(response).not.toHaveProperty('loans');
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        transaction: expect.objectContaining({
          type: 'PLAYER_TO_BANK',
          participants: [{ playerId: lenderId, balanceDelta: -10 }],
        }),
      }),
    );
  });
});

describe('bankruptcy and loans', () => {
  it('hands the creditor on as the loan heir, and returns the loans', async () => {
    const { banking, persist } = setup({ active: [loan] });
    const response = await banking.declareBankruptcy('game', {
      playerId: lenderId,
      creditorPlayerId: borrowerId,
    });
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({ bankruptPlayerId: lenderId, loanHeirPlayerId: borrowerId }),
    );
    expect(response.loans).toEqual([loan]);
  });

  it('has no loan heir when the player goes bankrupt to the bank', async () => {
    const { banking, persist } = setup();
    await banking.declareBankruptcy('game', { playerId: lenderId });
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({ bankruptPlayerId: lenderId, loanHeirPlayerId: null }),
    );
  });
});
