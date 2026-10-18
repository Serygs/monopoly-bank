import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaymentRequest, TradeRequest } from '../../shared/contracts/api.js';
import {
  defaultGameRules,
  type Auction,
  type Game,
  type Player,
  type Transaction,
} from '../../shared/types/monopoly.js';
import type { AuctionRepository } from '../repositories/auction-repository.js';
import type { BankingOperationRepository } from '../repositories/banking-operation-repository.js';
import type { GameRepository } from '../repositories/game-repository.js';
import type { LoanRepository } from '../repositories/loan-repository.js';
import type { MortgageRepository } from '../repositories/mortgage-repository.js';
import {
  PAYMENT_REQUEST_TTL_MS,
  type PaymentRequestRepository,
} from '../repositories/payment-request-repository.js';
import type { PlayerRepository } from '../repositories/player-repository.js';
import type { TradeRequestRepository } from '../repositories/trade-request-repository.js';
import type { TransactionRepository } from '../repositories/transaction-repository.js';
import { DefaultBankingService } from './banking-service.js';
import { DatabaseError } from './errors.js';

const stub = <T extends object>(partial: Partial<T>): T => partial as T;

const COMMAND_ID = '00000000-0000-4000-8000-00000000000a';
const NOW = Date.parse('2026-01-01T00:00:00.000Z');

const baseGame: Game = {
  id: 'g',
  name: 'G',
  startingBalance: 1000,
  passGoReward: 200,
  currency: 'USD',
  paymentMode: 'FAST',
  rules: defaultGameRules,
  settings: null,
  status: 'ACTIVE',
  createdAt: '',
  updatedAt: '',
};
const confirmation: Game = { ...baseGame, paymentMode: 'CONFIRMATION' };

const player = (id: string, balance = 1000, status: Player['status'] = 'ACTIVE'): Player => ({
  id,
  gameId: 'g',
  name: id,
  color: '#000',
  balance,
  status,
  createdAt: '',
});

const storedTransaction = (patch: Partial<Transaction> = {}): Transaction => ({
  id: COMMAND_ID,
  gameId: 'g',
  type: 'PLAYER_TO_BANK',
  amount: 10,
  totalAmount: 10,
  comment: null,
  createdAt: '',
  participants: [{ playerId: 'a', balanceDelta: -10 }],
  ...patch,
});

const request = (patch: Partial<PaymentRequest> = {}): PaymentRequest => ({
  id: 'r1',
  kind: 'PAYMENT',
  gameId: 'g',
  payerPlayerId: 'a',
  recipientPlayerId: 'b',
  creatorPlayerId: 'a',
  approverPlayerId: 'b',
  amount: 50,
  comment: null,
  state: 'PENDING',
  expiresAt: '',
  createdAt: '',
  resolvedAt: null,
  transactionId: null,
  ...patch,
});

interface World {
  game: Game | null;
  players: Player[];
  stored: Map<string, Transaction>;
  requests: Map<string, PaymentRequest>;
  trades: Map<string, TradeRequest>;
  reserved: Record<string, number>;
  activeAuction: Auction | null;
  persistError: unknown;
  persistWrites: boolean;
}

function setup(patch: Partial<World> = {}, withTrades = true) {
  const world: World = {
    game: baseGame,
    players: [player('a'), player('b'), player('c')],
    stored: new Map(),
    requests: new Map(),
    trades: new Map(),
    reserved: {},
    activeAuction: null,
    persistError: null,
    persistWrites: true,
    ...patch,
  };
  const persist = vi.fn(async (input: { transactionId: string }) => {
    if (world.persistError !== null) throw world.persistError;
    if (world.persistWrites)
      world.stored.set(input.transactionId, storedTransaction({ id: input.transactionId }));
  });
  const paymentRequests = {
    expirePending: vi.fn(async () => undefined),
    getById: vi.fn(async (_gameId: string, id: string) => world.requests.get(id) ?? null),
    listForPayers: vi.fn(async () => [...world.requests.values()]),
    pendingReservedAmount: vi.fn(async (_gameId: string, id: string) => world.reserved[id] ?? 0),
    create: vi.fn(
      async (input: Omit<PaymentRequest, 'createdAt' | 'resolvedAt' | 'transactionId'>) => {
        world.requests.set(input.id, {
          ...input,
          createdAt: '',
          resolvedAt: null,
          transactionId: null,
        });
      },
    ),
    resolve: vi.fn(async (id: string, state: PaymentRequest['state']) => {
      const current = world.requests.get(id);
      if (current !== undefined) world.requests.set(id, { ...current, state, resolvedAt: 'now' });
    }),
    settle: vi.fn(async (input: { requestId: string; transactionId: string }) => {
      const current = world.requests.get(input.requestId);
      if (current !== undefined)
        world.requests.set(input.requestId, {
          ...current,
          state: 'ACCEPTED',
          transactionId: input.transactionId,
        });
      world.stored.set(input.transactionId, storedTransaction({ id: input.transactionId }));
    }),
  };
  const tradeRequests = {
    expirePending: vi.fn(async () => undefined),
    getById: vi.fn(async (_gameId: string, id: string) => world.trades.get(id) ?? null),
    listPendingForPlayers: vi.fn(async () => [...world.trades.values()]),
    resolve: vi.fn(async (id: string, state: TradeRequest['state']) => {
      const current = world.trades.get(id);
      if (current !== undefined) world.trades.set(id, { ...current, state });
    }),
  };
  const transactions = {
    getById: vi.fn(async (_gameId: string, id: string) => world.stored.get(id) ?? null),
    listByGameId: vi.fn(async (_gameId: string, limit: number) => [
      storedTransaction({ amount: limit }),
    ]),
    listByPlayerId: vi.fn(async (_gameId: string, _playerId: string, limit: number) => [
      storedTransaction({ amount: limit }),
    ]),
    listChronologicalSince: vi.fn(async () => []),
  };
  const service = new DefaultBankingService({
    games: stub<GameRepository>({
      getById: async () => world.game,
      getJackpot: async () => 77,
    }),
    players: stub<PlayerRepository>({ listByGameId: async () => world.players }),
    transactions: stub<TransactionRepository>(transactions),
    operations: stub<BankingOperationRepository>({ persist }),
    paymentRequests: stub<PaymentRequestRepository>(paymentRequests),
    ...(withTrades ? { tradeRequests: stub<TradeRequestRepository>(tradeRequests) } : {}),
    mortgages: stub<MortgageRepository>({ listActive: async () => [] }),
    loans: stub<LoanRepository>({ listActive: async () => [] }),
    auctions: stub<AuctionRepository>({ getActive: async () => world.activeAuction }),
    createId: () => COMMAND_ID,
  });
  return { world, service, persist, paymentRequests, tradeRequests, transactions };
}

const caught = async (run: () => Promise<unknown>): Promise<unknown> => {
  try {
    await run();
  } catch (error) {
    return error;
  }
  return undefined;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('committing a transaction', () => {
  const payToBank = { type: 'PLAYER_TO_BANK' as const, playerId: 'a', amount: 10 };

  it('answers a repeated command with the transaction it already wrote and writes nothing', async () => {
    const existing = storedTransaction();
    const { service, persist } = setup({ stored: new Map([[COMMAND_ID, existing]]) });
    const result = await service.createTransaction('g', payToBank);
    expect(result.transaction).toBe(existing);
    expect(result.players).toHaveLength(3);
    expect(persist).not.toHaveBeenCalled();
  });

  it('carries the pot in a replay when the game has the jackpot rule', async () => {
    const { service } = setup({
      game: { ...baseGame, rules: { ...defaultGameRules, freeParkingJackpot: true } },
      stored: new Map([[COMMAND_ID, storedTransaction()]]),
    });
    expect(await service.createTransaction('g', payToBank)).toMatchObject({ jackpot: 77 });
  });

  it('refuses an unknown game', async () => {
    expect(
      await caught(() => setup({ game: null }).service.createTransaction('g', payToBank)),
    ).toMatchObject({
      code: 'GAME_NOT_FOUND',
      status: 404,
    });
  });

  it('returns the stored transaction with the balances after the write', async () => {
    const { service, persist } = setup();
    const result = await service.createTransaction('g', payToBank);
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: COMMAND_ID,
        recentAmount: 10,
        balanceChanges: [expect.objectContaining({ balanceBefore: 1000, balanceAfter: 990 })],
      }),
    );
    expect(result.transaction.id).toBe(COMMAND_ID);
    expect(result.players.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not remember the amount of operations that have no amount to repeat', async () => {
    const { service, persist } = setup();
    await service.createTransaction('g', { type: 'PASS_GO', playerId: 'a' });
    expect(persist.mock.calls[0]?.[0]).not.toHaveProperty('recentAmount');
  });

  it('reports a write that cannot be read back as a consistency failure', async () => {
    const { service } = setup({ persistWrites: false });
    expect(await caught(() => service.createTransaction('g', payToBank))).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'A persisted record could not be loaded.',
    });
  });

  it('rethrows a database error that no race explains', async () => {
    const failure = new DatabaseError({ operation: 'persist', cause: new Error('disk') });
    const { service } = setup({ persistError: failure });
    expect(await caught(() => service.createTransaction('g', payToBank))).toBe(failure);
  });

  it('refuses a trade as a direct transaction', async () => {
    expect(
      await caught(() =>
        setup().service.createTransaction('g', {
          type: 'PROPERTY_TRANSFER',
          playerId: 'a',
          counterpartyPlayerId: 'b',
          giveTileIds: ['zhitna'],
          takeTileIds: [],
        }),
      ),
    ).toMatchObject({ code: 'TRADE_REQUEST_REQUIRED', status: 409 });
  });

  it('refuses a payment that would eat into the reserve of the leading bidder', async () => {
    const auction: Auction = {
      id: 'au',
      gameId: 'g',
      lotName: 'Lot',
      initiatorPlayerId: 'a',
      state: 'ACTIVE',
      currentBid: 900,
      currentBidderId: 'a',
      version: 2,
      startedAt: '',
      endsAt: '',
      serverTime: '',
      settledTransactionId: null,
    };
    const { service, persist } = setup({
      game: { ...baseGame, rules: { ...defaultGameRules, auctions: true } },
      activeAuction: auction,
    });
    expect(
      await caught(() => service.createTransaction('g', { ...payToBank, amount: 101 })),
    ).toMatchObject({
      code: 'INSUFFICIENT_AVAILABLE_FUNDS',
      details: { playerId: 'a', available: 100, required: 101 },
    });
    await service.createTransaction('g', { ...payToBank, amount: 100 });
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('refuses a transaction in a finished game and one that needs a rule the game lacks', async () => {
    expect(
      await caught(() =>
        setup({ game: { ...baseGame, status: 'FINISHED' } }).service.createTransaction(
          'g',
          payToBank,
        ),
      ),
    ).toMatchObject({ code: 'GAME_FINISHED' });
    for (const body of [
      { type: 'TO_JACKPOT' as const, playerId: 'a', amount: 10 },
      { type: 'JACKPOT_PAYOUT' as const, playerId: 'a', expectedAmount: 10 },
      { type: 'LOAN_ISSUE' as const, lenderKind: 'BANK' as const, playerId: 'a', amount: 10 },
      {
        type: 'LOAN_ISSUE' as const,
        borrowerPlayerId: 'a',
        lenderPlayerId: 'b',
        amount: 10,
      },
      { type: 'LOAN_REPAYMENT' as const, playerId: 'a', loanId: 'l', amount: 10 },
    ])
      expect(await caught(() => setup().service.createTransaction('g', body))).toMatchObject({
        code: 'RULE_DISABLED',
      });
  });
});

describe('bank payments to a player through the service', () => {
  it('pays exactly 4 000 000 and refuses one unit more before writing anything', async () => {
    const paid = setup();
    const result = await paid.service.createTransaction('g', {
      type: 'BANK_TO_PLAYER',
      playerId: 'a',
      amount: 4_000_000,
    });
    expect(result.transaction.id).toBe(COMMAND_ID);
    expect(paid.persist).toHaveBeenCalledWith(
      expect.objectContaining({
        balanceChanges: [expect.objectContaining({ balanceAfter: 4_001_000 })],
      }),
    );
    const refused = setup();
    expect(
      await caught(() =>
        refused.service.createTransaction('g', {
          type: 'BANK_TO_PLAYER',
          playerId: 'a',
          amount: 4_000_001,
        }),
      ),
    ).toMatchObject({
      code: 'BANK_TO_PLAYER_LIMIT_EXCEEDED',
      status: 400,
      details: { field: 'amount', amount: 4_000_001, max: 4_000_000 },
    });
    expect(refused.persist).not.toHaveBeenCalled();
  });
});

describe('payments that need the other player’s answer', () => {
  const expiresAt = new Date(NOW + PAYMENT_REQUEST_TTL_MS).toISOString();

  it('turns a player payment into one request that the receiving player must answer', async () => {
    const { service, paymentRequests, persist } = setup({ game: confirmation });
    const result = await service.createTransaction('g', {
      type: 'PLAYER_TO_PLAYER',
      sourcePlayerId: 'a',
      destinationPlayerId: 'b',
      amount: 50,
    });
    expect(persist).not.toHaveBeenCalled();
    expect(paymentRequests.create).toHaveBeenCalledTimes(1);
    expect(paymentRequests.create).toHaveBeenCalledWith({
      id: '00000000-0000-4000-8000-000000000000',
      kind: 'PAYMENT',
      gameId: 'g',
      payerPlayerId: 'a',
      recipientPlayerId: 'b',
      creatorPlayerId: 'a',
      approverPlayerId: 'b',
      amount: 50,
      comment: null,
      state: 'PENDING',
      expiresAt,
    });
    expect(result).toMatchObject({ paymentRequests: [{ state: 'PENDING', expiresAt }] });
    expect(expiresAt).toBe('2026-01-01T00:05:00.000Z');
  });

  it('keeps the comment of the payment', async () => {
    const { service, paymentRequests } = setup({ game: confirmation });
    await service.createTransaction('g', {
      type: 'PLAYER_TO_PLAYER',
      sourcePlayerId: 'a',
      destinationPlayerId: 'b',
      amount: 50,
      comment: 'rent',
    });
    expect(paymentRequests.create).toHaveBeenCalledWith(
      expect.objectContaining({ comment: 'rent' }),
    );
  });

  it('turns everyone-pays-one into one request per other player, each answered by its payer', async () => {
    const { service, paymentRequests } = setup({ game: confirmation });
    const result = await service.createTransaction('g', {
      type: 'ALL_TO_PLAYER',
      recipientPlayerId: 'a',
      amountPerPlayer: 30,
      comment: 'tax',
    });
    expect(paymentRequests.create.mock.calls.map(([input]) => input)).toEqual([
      expect.objectContaining({
        id: '00000000-0000-4000-8000-000000000000',
        payerPlayerId: 'b',
        recipientPlayerId: 'a',
        creatorPlayerId: 'a',
        approverPlayerId: 'b',
        amount: 30,
        comment: 'tax',
      }),
      expect.objectContaining({
        id: '00000000-0000-4000-8000-000000000001',
        payerPlayerId: 'c',
        approverPlayerId: 'c',
        amount: 30,
      }),
    ]);
    expect(result).toMatchObject({
      paymentRequests: [{ payerPlayerId: 'b' }, { payerPlayerId: 'c' }],
    });
  });

  it('allows a request for exactly what the payer has free and refuses one unit more', async () => {
    const ok = setup({ game: confirmation, players: [player('a', 100), player('b'), player('c')] });
    await expect(
      ok.service.createTransaction('g', {
        type: 'PLAYER_TO_PLAYER',
        sourcePlayerId: 'a',
        destinationPlayerId: 'b',
        amount: 100,
      }),
    ).resolves.toBeDefined();
    const refused = setup({
      game: confirmation,
      players: [player('a', 100), player('b'), player('c')],
    });
    expect(
      await caught(() =>
        refused.service.createTransaction('g', {
          type: 'PLAYER_TO_PLAYER',
          sourcePlayerId: 'a',
          destinationPlayerId: 'b',
          amount: 101,
        }),
      ),
    ).toMatchObject({
      code: 'INSUFFICIENT_AVAILABLE_FUNDS',
      details: { playerId: 'a', available: 100, required: 101 },
    });
    expect(refused.paymentRequests.create).not.toHaveBeenCalled();
  });

  it('counts requests already waiting and a leading auction bid against what the payer has free', async () => {
    const auction: Auction = {
      id: 'au',
      gameId: 'g',
      lotName: 'Lot',
      initiatorPlayerId: 'a',
      state: 'ACTIVE',
      currentBid: 300,
      currentBidderId: 'a',
      version: 2,
      startedAt: '',
      endsAt: '',
      serverTime: '',
      settledTransactionId: null,
    };
    const { service, paymentRequests } = setup({
      game: { ...confirmation, rules: { ...defaultGameRules, auctions: true } },
      reserved: { a: 200 },
      activeAuction: auction,
    });
    const pay = (amount: number) =>
      service.createTransaction('g', {
        type: 'PLAYER_TO_PLAYER',
        sourcePlayerId: 'a',
        destinationPlayerId: 'b',
        amount,
      });
    expect(await caught(() => pay(501))).toMatchObject({
      code: 'INSUFFICIENT_AVAILABLE_FUNDS',
      details: { playerId: 'a', available: 500, required: 501 },
    });
    await pay(500);
    expect(paymentRequests.create).toHaveBeenCalledTimes(1);
  });

  it('refuses a payer who is not at the table, and a player paying themselves', async () => {
    const stranger = await caught(() =>
      setup({ game: confirmation }).service.createTransaction('g', {
        type: 'PLAYER_TO_PLAYER',
        sourcePlayerId: 'ghost',
        destinationPlayerId: 'b',
        amount: 10,
      }),
    );
    expect(stranger).toMatchObject({ code: 'INVALID_PAYMENT_REQUEST', status: 409 });
    const self = await caught(() =>
      setup({ game: confirmation }).service.createTransaction('g', {
        type: 'PLAYER_TO_PLAYER',
        sourcePlayerId: 'a',
        destinationPlayerId: 'a',
        amount: 10,
      }),
    );
    expect(self).toMatchObject({ code: 'INVALID_PAYMENT_REQUEST' });
  });

  it('does not ask for confirmation for the other kinds of payment', async () => {
    const { service, persist, paymentRequests } = setup({ game: confirmation });
    await service.createTransaction('g', { type: 'PLAYER_TO_BANK', playerId: 'a', amount: 10 });
    expect(persist).toHaveBeenCalledTimes(1);
    expect(paymentRequests.create).not.toHaveBeenCalled();
  });
});

describe('answering a payment request', () => {
  it('settles a pending request as an ordinary player payment', async () => {
    const { service, paymentRequests, world } = setup({
      requests: new Map([['r1', request({ comment: 'rent' })]]),
    });
    const result = await service.acceptPaymentRequest('g', 'r1');
    expect(paymentRequests.expirePending).toHaveBeenCalledWith('g');
    expect(paymentRequests.settle).toHaveBeenCalledWith({
      requestId: 'r1',
      transactionId: COMMAND_ID,
      transaction: expect.objectContaining({
        type: 'PLAYER_TO_PLAYER',
        amount: 50,
        comment: 'rent',
        participants: [
          { playerId: 'a', balanceDelta: -50 },
          { playerId: 'b', balanceDelta: 50 },
        ],
      }),
      balanceChanges: [
        expect.objectContaining({ balanceAfter: 950 }),
        expect.objectContaining({ balanceAfter: 1050 }),
      ],
    });
    expect(result.paymentRequest).toBe(world.requests.get('r1'));
    expect(result.paymentRequest.state).toBe('ACCEPTED');
    expect(result.transaction.id).toBe(COMMAND_ID);
    expect(result.players).toHaveLength(3);
  });

  it('settles a request with no comment without inventing one', async () => {
    const { service, paymentRequests } = setup({ requests: new Map([['r1', request()]]) });
    await service.acceptPaymentRequest('g', 'r1');
    expect(paymentRequests.settle.mock.calls[0]?.[0]).toMatchObject({
      transaction: { comment: null },
    });
  });

  it('answers a request that was already accepted with its transaction and settles nothing', async () => {
    const accepted = request({ state: 'ACCEPTED', transactionId: 'tx-9' });
    const { service, paymentRequests } = setup({
      requests: new Map([['r1', accepted]]),
      stored: new Map([['tx-9', storedTransaction({ id: 'tx-9' })]]),
    });
    const result = await service.acceptPaymentRequest('g', 'r1');
    expect(result.transaction.id).toBe('tx-9');
    expect(result.paymentRequest).toBe(accepted);
    expect(paymentRequests.settle).not.toHaveBeenCalled();
  });

  it('reports an accepted request whose transaction is missing as a consistency failure', async () => {
    for (const transactionId of [null, 'gone'])
      expect(
        await caught(() =>
          setup({
            requests: new Map([['r1', request({ state: 'ACCEPTED', transactionId })]]),
          }).service.acceptPaymentRequest('g', 'r1'),
        ),
      ).toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it.each(['DECLINED', 'CANCELLED', 'EXPIRED'] as const)(
    'refuses to accept a %s request',
    async (state) => {
      const { service, paymentRequests } = setup({
        requests: new Map([['r1', request({ state })]]),
      });
      expect(await caught(() => service.acceptPaymentRequest('g', 'r1'))).toMatchObject({
        code: 'PAYMENT_REQUEST_NOT_PENDING',
        status: 409,
      });
      expect(paymentRequests.settle).not.toHaveBeenCalled();
    },
  );

  it('refuses a request that does not exist or a game that does not exist', async () => {
    expect(await caught(() => setup().service.acceptPaymentRequest('g', 'nope'))).toMatchObject({
      status: 404,
      message: 'Payment request not found.',
    });
    expect(
      await caught(() =>
        setup({ game: null, requests: new Map([['r1', request()]]) }).service.acceptPaymentRequest(
          'g',
          'r1',
        ),
      ),
    ).toMatchObject({ code: 'GAME_NOT_FOUND' });
  });

  it('refuses to accept when the payer can no longer pay, and writes nothing', async () => {
    const { service, paymentRequests } = setup({
      requests: new Map([['r1', request({ amount: 2000 })]]),
    });
    expect(await caught(() => service.acceptPaymentRequest('g', 'r1'))).toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
    });
    expect(paymentRequests.settle).not.toHaveBeenCalled();
  });

  it('refuses to accept a loan request when the game has no player loans', async () => {
    const { service } = setup({ requests: new Map([['r1', request({ kind: 'LOAN' })]]) });
    expect(await caught(() => service.acceptPaymentRequest('g', 'r1'))).toMatchObject({
      code: 'RULE_DISABLED',
      details: { rule: 'playerLoans' },
    });
  });

  it.each([
    ['declinePaymentRequest', 'DECLINED'],
    ['cancelPaymentRequest', 'CANCELLED'],
  ] as const)('%s resolves a pending request as %s', async (method, state) => {
    const { service, paymentRequests } = setup({ requests: new Map([['r1', request()]]) });
    const result = await service[method]('g', 'r1');
    expect(paymentRequests.resolve).toHaveBeenCalledWith('r1', state);
    expect(result.paymentRequest.state).toBe(state);
    expect(result.players).toHaveLength(3);
  });

  it('leaves a request that is no longer pending as it is when it is declined again', async () => {
    const { service, paymentRequests } = setup({
      requests: new Map([['r1', request({ state: 'ACCEPTED', transactionId: 'x' })]]),
    });
    const result = await service.declinePaymentRequest('g', 'r1');
    expect(paymentRequests.resolve).not.toHaveBeenCalled();
    expect(result.paymentRequest.state).toBe('ACCEPTED');
  });

  it('carries the pot when the game has the jackpot rule', async () => {
    const { service } = setup({
      game: { ...baseGame, rules: { ...defaultGameRules, freeParkingJackpot: true } },
      requests: new Map([['r1', request()]]),
    });
    expect(await service.cancelPaymentRequest('g', 'r1')).toMatchObject({ jackpot: 77 });
  });

  it('refuses to answer a request that does not exist', async () => {
    expect(await caught(() => setup().service.declinePaymentRequest('g', 'nope'))).toMatchObject({
      status: 404,
    });
  });

  it('reads one request after expiring the stale ones, and lists the requests of the wallets', async () => {
    const pending = request();
    const { service, paymentRequests } = setup({ requests: new Map([['r1', pending]]) });
    await expect(service.getPaymentRequest('g', 'r1')).resolves.toBe(pending);
    expect(paymentRequests.expirePending).toHaveBeenCalledWith('g');
    await expect(service.getPaymentRequest('g', 'missing')).resolves.toBeNull();
    await expect(service.listPaymentRequests('g', ['a'])).resolves.toEqual([pending]);
    expect(paymentRequests.listForPayers).toHaveBeenCalledWith('g', ['a']);
  });
});

describe('looking up transactions', () => {
  it('reads one transaction and lists a game’s transactions with the limit asked for', async () => {
    const { service, transactions } = setup({
      stored: new Map([['t1', storedTransaction({ id: 't1' })]]),
    });
    await expect(service.getTransaction('g', 't1')).resolves.toMatchObject({ id: 't1' });
    await expect(service.getTransaction('g', 'nope')).resolves.toBeNull();
    await expect(service.listTransactions('g', 25)).resolves.toMatchObject([{ amount: 25 }]);
    expect(transactions.listByGameId).toHaveBeenCalledWith('g', 25);
  });

  it('lists the transactions of a player of the game and refuses a player who is not in it', async () => {
    const { service, transactions } = setup();
    await expect(service.listPlayerTransactions('g', 'a', 10)).resolves.toMatchObject([
      { amount: 10 },
    ]);
    expect(transactions.listByPlayerId).toHaveBeenCalledWith('g', 'a', 10);
    expect(await caught(() => service.listPlayerTransactions('g', 'ghost', 10))).toMatchObject({
      code: 'PLAYER_NOT_FOUND',
      status: 404,
    });
  });
});

describe('answering a trade request', () => {
  const trade = (patch: Partial<TradeRequest> = {}): TradeRequest => ({
    id: 't1',
    gameId: 'g',
    proposerPlayerId: 'a',
    counterpartyPlayerId: 'b',
    giveTileIds: ['zhitna'],
    takeTileIds: [],
    cashGive: 0,
    cashTake: 0,
    state: 'PENDING',
    expiresAt: '',
    createdAt: '',
    resolvedAt: null,
    transactionId: null,
    ...patch,
  });

  it.each([
    ['declineTradeRequest', 'DECLINED'],
    ['cancelTradeRequest', 'CANCELLED'],
  ] as const)('%s resolves a pending trade as %s', async (method, state) => {
    const { service, tradeRequests } = setup({ trades: new Map([['t1', trade()]]) });
    const result = await service[method]('g', 't1');
    expect(tradeRequests.expirePending).toHaveBeenCalledWith('g');
    expect(tradeRequests.resolve).toHaveBeenCalledWith('t1', state);
    expect(result.tradeRequest.state).toBe(state);
    expect(result.players).toHaveLength(3);
  });

  it('repeating the same answer is harmless and writes nothing', async () => {
    const { service, tradeRequests } = setup({
      trades: new Map([['t1', trade({ state: 'DECLINED' })]]),
    });
    await expect(service.declineTradeRequest('g', 't1')).resolves.toMatchObject({
      tradeRequest: { state: 'DECLINED' },
    });
    expect(tradeRequests.resolve).not.toHaveBeenCalled();
  });

  it('refuses to turn an answered trade into the other answer', async () => {
    const { service } = setup({ trades: new Map([['t1', trade({ state: 'ACCEPTED' })]]) });
    expect(await caught(() => service.cancelTradeRequest('g', 't1'))).toMatchObject({
      code: 'TRADE_REQUEST_NOT_PENDING',
      status: 409,
      details: { state: 'ACCEPTED' },
    });
  });

  it('refuses a trade that does not exist', async () => {
    expect(await caught(() => setup().service.declineTradeRequest('g', 'nope'))).toMatchObject({
      status: 404,
      message: 'Trade request not found.',
    });
  });

  it('reads one trade after expiring the stale ones and lists the trades of the wallets', async () => {
    const pending = trade();
    const { service, tradeRequests } = setup({ trades: new Map([['t1', pending]]) });
    await expect(service.getTradeRequest('g', 't1')).resolves.toBe(pending);
    expect(tradeRequests.expirePending).toHaveBeenCalledWith('g');
    await expect(service.getTradeRequest('g', 'missing')).resolves.toBeNull();
    await expect(service.listTradeRequests('g', ['a'])).resolves.toEqual([pending]);
    expect(tradeRequests.listPendingForPlayers).toHaveBeenCalledWith('g', ['a']);
  });

  it('reports a game without trade storage as a consistency failure, and lists no trades', async () => {
    const { service } = setup({}, false);
    await expect(service.listTradeRequests('g', ['a'])).resolves.toEqual([]);
    expect(await caught(() => service.getTradeRequest('g', 't1'))).toMatchObject({
      code: 'INTERNAL_ERROR',
    });
    expect(await caught(() => service.declineTradeRequest('g', 't1'))).toMatchObject({
      code: 'INTERNAL_ERROR',
    });
  });
});

describe('declaring bankruptcy through the service', () => {
  const broke = { playerId: 'a' };

  it('refuses an unknown game', async () => {
    expect(
      await caught(() => setup({ game: null }).service.declareBankruptcy('g', broke)),
    ).toMatchObject({
      code: 'GAME_NOT_FOUND',
    });
  });

  it('hands the wallet to the bank and withdraws nothing without an auctions rule', async () => {
    const { service, persist } = setup();
    const response = await service.declareBankruptcy('g', broke);
    const input = persist.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input).toMatchObject({
      transactionId: COMMAND_ID,
      bankruptPlayerId: 'a',
      mortgageHeirPlayerId: null,
      loanHeirPlayerId: null,
      transaction: { type: 'BANKRUPTCY_TRANSFER', amount: 1000 },
    });
    expect(input).not.toHaveProperty('withdrawAuctionBid');
    expect(response).toMatchObject({ mortgages: [], loans: [] });
    expect(response.transaction.id).toBe(COMMAND_ID);
  });

  it('names the creditor as the heir of the mortgages and loans, and withdraws the bid with auctions on', async () => {
    const { service, persist } = setup({
      game: { ...baseGame, rules: { ...defaultGameRules, auctions: true } },
    });
    await service.declareBankruptcy('g', { playerId: 'a', creditorPlayerId: 'b' });
    expect(persist.mock.calls[0]?.[0]).toMatchObject({
      bankruptPlayerId: 'a',
      mortgageHeirPlayerId: 'b',
      loanHeirPlayerId: 'b',
      withdrawAuctionBid: true,
      balanceChanges: [
        expect.objectContaining({ balanceAfter: 0 }),
        expect.objectContaining({ balanceAfter: 2000 }),
      ],
    });
  });

  it('writes the bankruptcy when a running auction has no leading bid to protect', async () => {
    const auction: Auction = {
      id: 'au',
      gameId: 'g',
      lotName: 'Lot',
      initiatorPlayerId: 'b',
      state: 'ACTIVE',
      currentBid: 0,
      currentBidderId: null,
      version: 1,
      startedAt: '',
      endsAt: '',
      serverTime: '',
      settledTransactionId: null,
    };
    const { service, persist } = setup({
      game: { ...baseGame, rules: { ...defaultGameRules, auctions: true } },
      activeAuction: auction,
    });
    await service.declareBankruptcy('g', { playerId: 'a', creditorPlayerId: 'b' });
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('answers a repeated bankruptcy command with the transaction it already wrote', async () => {
    const existing = storedTransaction({ type: 'BANKRUPTCY_TRANSFER' });
    const { service, persist } = setup({ stored: new Map([[COMMAND_ID, existing]]) });
    const response = await service.declareBankruptcy('g', broke);
    expect(response.transaction).toBe(existing);
    expect(response).toMatchObject({ mortgages: [], loans: [] });
    expect(persist).not.toHaveBeenCalled();
  });

  it('carries the pot in the response when the game has the jackpot rule', async () => {
    const { service } = setup({
      game: { ...baseGame, rules: { ...defaultGameRules, freeParkingJackpot: true } },
    });
    expect(await service.declareBankruptcy('g', broke)).toMatchObject({ jackpot: 77 });
  });

  it('reports a write that cannot be read back as a consistency failure', async () => {
    const { service } = setup({ persistWrites: false });
    expect(await caught(() => service.declareBankruptcy('g', broke))).toMatchObject({
      code: 'INTERNAL_ERROR',
    });
  });

  it('refuses a creditor who is the bankrupt player or already bankrupt before writing', async () => {
    const same = setup();
    expect(
      await caught(() =>
        same.service.declareBankruptcy('g', { playerId: 'a', creditorPlayerId: 'a' }),
      ),
    ).toMatchObject({ code: 'SAME_SOURCE_AND_DESTINATION' });
    const gone = setup({ players: [player('a'), player('b', 0, 'BANKRUPT'), player('c')] });
    expect(
      await caught(() =>
        gone.service.declareBankruptcy('g', { playerId: 'a', creditorPlayerId: 'b' }),
      ),
    ).toMatchObject({ code: 'PLAYER_BANKRUPT' });
    expect(same.persist).not.toHaveBeenCalled();
    expect(gone.persist).not.toHaveBeenCalled();
  });
});

describe('proposing and accepting a trade request', () => {
  const existing: TradeRequest = {
    id: 't1',
    gameId: 'g',
    proposerPlayerId: 'a',
    counterpartyPlayerId: 'b',
    giveTileIds: ['zhitna', 'nagatinska'],
    takeTileIds: ['arbat'],
    cashGive: 5,
    cashTake: 0,
    state: 'PENDING',
    expiresAt: '',
    createdAt: '',
    resolvedAt: null,
    transactionId: null,
  };
  const same = {
    id: 't1',
    playerId: 'a',
    counterpartyPlayerId: 'b',
    giveTileIds: ['zhitna', 'nagatinska'],
    takeTileIds: ['arbat'],
    cashGive: 5,
  };

  it('answers a repeated proposal with the request it already made', async () => {
    const { service } = setup({ trades: new Map([['t1', existing]]) });
    await expect(service.createTradeRequest('g', same)).resolves.toEqual({
      tradeRequest: existing,
    });
  });

  it.each([
    ['another proposer', { playerId: 'c' }],
    ['another counterparty', { counterpartyPlayerId: 'c' }],
    ['other tiles given', { giveTileIds: ['zhitna', 'arbat'] }],
    ['fewer tiles given', { giveTileIds: ['zhitna'] }],
    ['more tiles given', { giveTileIds: ['zhitna', 'nagatinska', 'arbat'] }],
    ['other tiles taken', { takeTileIds: ['zhitna'] }],
    ['no tile taken', { takeTileIds: [] }],
    ['other cash given', { cashGive: 6 }],
    ['cash taken', { cashTake: 1 }],
  ])('refuses the id of an earlier proposal with %s', async (_label, patch) => {
    const { service } = setup({ trades: new Map([['t1', existing]]) });
    expect(
      await caught(() => service.createTradeRequest('g', { ...same, ...patch })),
    ).toMatchObject({
      code: 'TRADE_REQUEST_EXISTS',
      status: 409,
    });
  });

  it('treats missing cash as zero when comparing a repeated proposal', async () => {
    const { service } = setup({ trades: new Map([['t1', { ...existing, cashGive: 0 }]]) });
    const { cashGive: _omitted, ...withoutCash } = same;
    await expect(service.createTradeRequest('g', withoutCash)).resolves.toMatchObject({
      tradeRequest: { id: 't1' },
    });
  });

  it('refuses an unknown game, and a game that has no board for a new proposal', async () => {
    expect(
      await caught(() => setup({ game: null }).service.createTradeRequest('g', same)),
    ).toMatchObject({
      code: 'GAME_NOT_FOUND',
    });
    expect(await caught(() => setup().service.createTradeRequest('g', same))).toMatchObject({
      code: 'BOARD_DISABLED',
    });
  });

  it('answers an accepted trade with its transaction and settles nothing again', async () => {
    const accepted: TradeRequest = { ...existing, state: 'ACCEPTED', transactionId: 'tx-5' };
    const { service, tradeRequests } = setup({
      trades: new Map([['t1', accepted]]),
      stored: new Map([['tx-5', storedTransaction({ id: 'tx-5', type: 'PROPERTY_TRANSFER' })]]),
    });
    const response = await service.acceptTradeRequest('g', 't1');
    expect(response.transaction.id).toBe('tx-5');
    expect(response.tradeRequest).toBe(accepted);
    expect(response.players).toHaveLength(3);
    expect(response).toMatchObject({ mortgages: [] });
    expect(tradeRequests.resolve).not.toHaveBeenCalled();
  });

  it('reports an accepted trade whose transaction is missing as a consistency failure', async () => {
    for (const transactionId of [null, 'gone'])
      expect(
        await caught(() =>
          setup({
            trades: new Map([['t1', { ...existing, state: 'ACCEPTED' as const, transactionId }]]),
          }).service.acceptTradeRequest('g', 't1'),
        ),
      ).toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it.each(['DECLINED', 'CANCELLED', 'EXPIRED'] as const)(
    'refuses to accept a %s trade',
    async (state) => {
      const { service } = setup({ trades: new Map([['t1', { ...existing, state }]]) });
      expect(await caught(() => service.acceptTradeRequest('g', 't1'))).toMatchObject({
        code: 'TRADE_REQUEST_NOT_PENDING',
        details: { state },
      });
    },
  );
});

describe('request flow edge cases', () => {
  it('asks only the active players to pay when everyone pays one player in a game with a bankrupt player and no money', async () => {
    const { service, paymentRequests } = setup({
      game: confirmation,
      players: [player('a'), player('b'), player('c', 0, 'BANKRUPT')],
    });
    await service.createTransaction('g', {
      type: 'ALL_TO_PLAYER',
      recipientPlayerId: 'a',
      amountPerPlayer: 30,
    });
    expect(paymentRequests.create).toHaveBeenCalledTimes(1);
  });

  it('reports a missing payment request with a code the client can map', async () => {
    expect(await caught(() => setup().service.declinePaymentRequest('g', 'nope'))).toMatchObject({
      code: 'PAYMENT_REQUEST_NOT_FOUND',
    });
  });

  it('reports a missing trade request with the code the client maps', async () => {
    expect(await caught(() => setup().service.declineTradeRequest('g', 'nope'))).toMatchObject({
      code: 'TRADE_REQUEST_NOT_FOUND',
    });
  });
});
