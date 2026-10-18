import { describe, expect, it, vi } from 'vitest';
import type { BoardSnapshot } from '../../shared/board/types.js';
import { buildGameSettings } from '../../shared/domain/game-rules.js';
import {
  defaultGameRules,
  type Auction,
  type Game,
  type GameProperty,
  type Player,
  type Transaction,
} from '../../shared/types/monopoly.js';
import type { BankingOperationRepository } from '../repositories/banking-operation-repository.js';
import type { AuctionRepository } from '../repositories/auction-repository.js';
import type { GameRepository } from '../repositories/game-repository.js';
import type { PaymentRequestRepository } from '../repositories/payment-request-repository.js';
import type { PlayerRepository } from '../repositories/player-repository.js';
import type { PropertyRepository } from '../repositories/property-repository.js';
import type { TransactionRepository } from '../repositories/transaction-repository.js';
import { DefaultAuctionService } from './auction-service.js';
import { DatabaseError } from './errors.js';

const stub = <T extends object>(partial: Partial<T>): T => partial as T;

const START = Date.parse('2026-01-01T00:00:00.000Z');
const settings = buildGameSettings(1500);
const boardSettings = buildGameSettings(15_000_000, 'monopoly-ru-2012');
const board = boardSettings.board as BoardSnapshot;

const baseGame: Game = {
  id: 'g',
  name: 'G',
  startingBalance: 1500,
  passGoReward: 200,
  currency: 'USD',
  paymentMode: 'FAST',
  rules: { ...defaultGameRules, auctions: true },
  settings,
  status: 'ACTIVE',
  createdAt: '',
  updatedAt: '',
};

const player = (id: string, balance = 1000, status: Player['status'] = 'ACTIVE'): Player => ({
  id,
  gameId: 'g',
  name: id,
  color: '#000',
  balance,
  status,
  createdAt: '',
});

const auctionRow = (patch: Partial<Auction> = {}): Auction => ({
  id: 'a1',
  gameId: 'g',
  lotName: 'Lot',
  initiatorPlayerId: 'p1',
  state: 'ACTIVE',
  currentBid: 0,
  currentBidderId: null,
  version: 1,
  startedAt: new Date(START).toISOString(),
  endsAt: new Date(START + 30_000).toISOString(),
  serverTime: '',
  settledTransactionId: null,
  ...patch,
});

interface World {
  game: Game | null;
  players: Player[];
  playerSnapshots: Player[][];
  auctions: Map<string, Auction>;
  registry: GameProperty[];
  transactions: Map<string, Transaction>;
  reserved: number;
  now: number;
  placeBidResult: boolean;
  createError: unknown;
  persistError: unknown;
}

function setup(patch: Partial<World> = {}, withProperties = true) {
  const world: World = {
    game: baseGame,
    players: [player('p1'), player('p2')],
    playerSnapshots: [],
    auctions: new Map(),
    registry: [],
    transactions: new Map(),
    reserved: 0,
    now: START,
    placeBidResult: true,
    createError: null,
    persistError: null,
    ...patch,
  };
  const auctions = {
    getActive: vi.fn(
      async () => [...world.auctions.values()].find((item) => item.state === 'ACTIVE') ?? null,
    ),
    getById: vi.fn(async (_gameId: string, id: string) => world.auctions.get(id) ?? null),
    getCurrent: vi.fn(async () => null),
    create: vi.fn(
      async (input: {
        id: string;
        lotName: string;
        tileId?: string | null;
        initiatorPlayerId: string;
        startedAt: string;
        endsAt: string;
      }) => {
        if (world.createError !== null) throw world.createError;
        world.auctions.set(
          input.id,
          auctionRow({
            id: input.id,
            lotName: input.lotName,
            tileId: input.tileId ?? null,
            initiatorPlayerId: input.initiatorPlayerId,
            startedAt: input.startedAt,
            endsAt: input.endsAt,
          }),
        );
      },
    ),
    placeBid: vi.fn(async () => world.placeBidResult),
    closeWithoutSale: vi.fn(async (_gameId: string, id: string, version: number) => {
      const current = world.auctions.get(id);
      if (current === undefined || current.version !== version) return false;
      world.auctions.set(id, { ...current, state: 'NO_SALE', version: version + 1 });
      return true;
    }),
  };
  const persist = vi.fn(
    async (input: {
      transactionId: string;
      transaction: { settlesAuction?: { auctionId: string } };
      balanceChanges: unknown[];
    }) => {
      if (world.persistError !== null) throw world.persistError;
      const settles = input.transaction.settlesAuction;
      if (settles !== undefined) {
        const current = world.auctions.get(settles.auctionId);
        if (current !== undefined)
          world.auctions.set(current.id, {
            ...current,
            state: 'SOLD',
            version: current.version + 1,
            settledTransactionId: input.transactionId,
          });
      }
      world.transactions.set(input.transactionId, {
        id: input.transactionId,
        gameId: 'g',
        type: 'AUCTION_PAYMENT',
        amount: 1,
        totalAmount: 1,
        comment: null,
        createdAt: '',
        participants: [],
      });
    },
  );
  const properties = {
    listByGame: vi.fn(async () => world.registry),
  };
  const service = new DefaultAuctionService({
    games: stub<GameRepository>({ getById: async () => world.game }),
    players: stub<PlayerRepository>({
      listByGameId: async () => world.playerSnapshots.shift() ?? world.players,
    }),
    transactions: stub<TransactionRepository>({
      getById: async (_gameId: string, id: string) => world.transactions.get(id) ?? null,
    }),
    operations: stub<BankingOperationRepository>({ persist }),
    paymentRequests: stub<PaymentRequestRepository>({
      pendingReservedAmount: async () => world.reserved,
    }),
    auctions: stub<AuctionRepository>(auctions),
    ...(withProperties ? { properties: stub<PropertyRepository>(properties) } : {}),
    now: () => world.now,
    createId: () => 'settlement-1',
  });
  return { world, service, auctions, persist, properties };
}

const caught = async (run: () => Promise<unknown>): Promise<unknown> => {
  try {
    await run();
  } catch (error) {
    return error;
  }
  return undefined;
};

const start = { initiatorPlayerId: 'p1', lotName: 'Lot' };
const bid = { bidderPlayerId: 'p2', auctionId: 'a1', expectedVersion: 1, step: 25 };

describe('current auction', () => {
  it('refuses an unknown game', async () => {
    const { service } = setup({ game: null });
    expect(await caught(() => service.getCurrent('g'))).toMatchObject({
      code: 'GAME_NOT_FOUND',
      status: 404,
    });
  });

  it('shows nothing and reads nothing when the game has no auctions', async () => {
    const { service, auctions } = setup({ game: { ...baseGame, rules: defaultGameRules } });
    await expect(service.getCurrent('g')).resolves.toBeNull();
    expect(auctions.getCurrent).not.toHaveBeenCalled();
  });

  it('asks the repository for the running or recently closed auction at the current time', async () => {
    const { service, auctions } = setup({ now: START + 5 });
    await service.getCurrent('g');
    expect(auctions.getCurrent).toHaveBeenCalledWith('g', START + 5);
  });
});

describe('starting an auction', () => {
  it('refuses when the rule is off, the game is not active or the game is unknown', async () => {
    expect(
      await caught(() =>
        setup({ game: { ...baseGame, rules: defaultGameRules } }).service.startAuction(
          'g',
          start,
          'a1',
        ),
      ),
    ).toMatchObject({ code: 'RULE_DISABLED', details: { rule: 'auctions' } });
    expect(
      await caught(() =>
        setup({ game: { ...baseGame, status: 'FINISHED' } }).service.startAuction('g', start, 'a1'),
      ),
    ).toMatchObject({ code: 'GAME_FINISHED' });
    expect(
      await caught(() => setup({ game: null }).service.startAuction('g', start, 'a1')),
    ).toMatchObject({
      code: 'GAME_NOT_FOUND',
    });
  });

  it('starts a free-text auction that runs for 30 seconds from now', async () => {
    const { service, auctions } = setup();
    const result = await service.startAuction('g', { ...start, lotName: '  Park   Lane ' }, 'a1');
    expect(auctions.create).toHaveBeenCalledWith({
      id: 'a1',
      gameId: 'g',
      lotName: 'Park Lane',
      tileId: null,
      initiatorPlayerId: 'p1',
      startedAt: '2026-01-01T00:00:00.000Z',
      endsAt: '2026-01-01T00:00:30.000Z',
    });
    expect(result.auction).toMatchObject({ id: 'a1', lotName: 'Park Lane', state: 'ACTIVE' });
  });

  it('answers a repeated start with the auction it already made', async () => {
    const { service, auctions, world } = setup();
    const existing = auctionRow({ lotName: 'Earlier' });
    world.auctions.set('a1', existing);
    await expect(service.startAuction('g', start, 'a1')).resolves.toEqual({ auction: existing });
    expect(auctions.create).not.toHaveBeenCalled();
  });

  it('refuses a lot name that is empty, too long or has control characters', async () => {
    for (const lotName of ['', '   ', 'x'.repeat(61), 'bad\u0007name'])
      expect(
        await caught(() => setup().service.startAuction('g', { ...start, lotName }, 'a1')),
      ).toMatchObject({
        code: 'VALIDATION_ERROR',
        status: 400,
        details: { field: 'lotName' },
      });
  });

  it('refuses an initiator who is not at the table or is bankrupt', async () => {
    expect(
      await caught(() =>
        setup().service.startAuction('g', { ...start, initiatorPlayerId: 'ghost' }, 'a1'),
      ),
    ).toMatchObject({ code: 'PLAYER_NOT_FOUND' });
    expect(
      await caught(() =>
        setup({ players: [player('p1', 0, 'BANKRUPT'), player('p2')] }).service.startAuction(
          'g',
          start,
          'a1',
        ),
      ),
    ).toMatchObject({ code: 'PLAYER_BANKRUPT', details: { playerId: 'p1' } });
  });

  it('refuses a second running auction and names the first', async () => {
    const { service, auctions, world } = setup();
    world.auctions.set('running', auctionRow({ id: 'running' }));
    expect(await caught(() => service.startAuction('g', start, 'a2'))).toMatchObject({
      code: 'AUCTION_ALREADY_ACTIVE',
      details: { auctionId: 'running' },
    });
    expect(auctions.create).not.toHaveBeenCalled();
  });

  it('reports the winner of a race on the unique running auction', async () => {
    const racing = setup({
      createError: new DatabaseError({ operation: 'create', cause: new Error('unique') }),
    });
    racing.auctions.getActive
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(auctionRow({ id: 'winner' }));
    expect(await caught(() => racing.service.startAuction('g', start, 'a2'))).toMatchObject({
      code: 'AUCTION_ALREADY_ACTIVE',
      details: { auctionId: 'winner' },
    });
  });

  it('rethrows the database error when nobody else is running or the winner is the same request', async () => {
    const failure = new DatabaseError({ operation: 'create', cause: new Error('disk') });
    expect(
      await caught(() => setup({ createError: failure }).service.startAuction('g', start, 'a2')),
    ).toBe(failure);
    const same = setup({ createError: failure });
    same.auctions.getActive
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(auctionRow({ id: 'a2' }));
    expect(await caught(() => same.service.startAuction('g', start, 'a2'))).toBe(failure);
  });

  it('rethrows an error that is not a database error without looking for a winner', async () => {
    const failure = new Error('boom');
    const { service, auctions } = setup({ createError: failure });
    expect(await caught(() => service.startAuction('g', start, 'a2'))).toBe(failure);
    expect(auctions.getActive).toHaveBeenCalledTimes(1);
  });

  it('reports a started auction that cannot be read back as a consistency failure', async () => {
    const { service, auctions } = setup();
    auctions.create.mockImplementation(async () => undefined);
    expect(await caught(() => service.startAuction('g', start, 'a1'))).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'A persisted record could not be loaded.',
    });
  });
});

describe('starting an auction for a board tile', () => {
  const boardGame: Game = { ...baseGame, settings: boardSettings, startingBalance: 15_000_000 };
  const row = (tileId: string, ownerPlayerId: string | null): GameProperty => ({
    gameId: 'g',
    tileId,
    ownerPlayerId,
    mortgaged: false,
    houses: 0,
  });

  it('sells an unowned tile under the name on the board and remembers the tile', async () => {
    const { service, auctions } = setup({ game: boardGame, registry: [row('zhitna', null)] });
    const result = await service.startAuction(
      'g',
      { initiatorPlayerId: 'p1', lotName: 'ignored', tileId: 'zhitna' },
      'a1',
    );
    expect(auctions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        lotName: board.tiles.find((tile) => tile.id === 'zhitna')?.name,
        tileId: 'zhitna',
      }),
    );
    expect(result.auction.tileId).toBe('zhitna');
  });

  it('refuses a tile that has an owner, one that is not on the board and a free-text lot on a board game', async () => {
    const owned = setup({ game: boardGame, registry: [row('zhitna', 'p2')] });
    expect(
      await caught(() => owned.service.startAuction('g', { ...start, tileId: 'zhitna' }, 'a1')),
    ).toMatchObject({
      code: 'PROPERTY_ALREADY_OWNED',
      details: { tileId: 'zhitna', ownerPlayerId: 'p2' },
    });
    expect(
      await caught(() =>
        setup({ game: boardGame }).service.startAuction('g', { ...start, tileId: 'nowhere' }, 'a1'),
      ),
    ).toMatchObject({ code: 'TILE_NOT_FOUND' });
    expect(
      await caught(() => setup({ game: boardGame }).service.startAuction('g', start, 'a1')),
    ).toMatchObject({
      code: 'TILE_REQUIRED',
    });
  });

  it('refuses a tile in a game without a board, and when the registry is not available', async () => {
    expect(
      await caught(() => setup().service.startAuction('g', { ...start, tileId: 'zhitna' }, 'a1')),
    ).toMatchObject({
      code: 'BOARD_DISABLED',
    });
    expect(
      await caught(() =>
        setup({ game: boardGame }, false).service.startAuction(
          'g',
          { ...start, tileId: 'zhitna' },
          'a1',
        ),
      ),
    ).toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});

describe('placing a bid', () => {
  const running = (patch: Partial<Auction> = {}) => new Map([['a1', auctionRow(patch)]]);

  it('refuses when the rule is off, the game is finished, the game has no settings or the auction is unknown', async () => {
    expect(
      await caught(() =>
        setup({ game: { ...baseGame, rules: defaultGameRules } }).service.placeBid('g', bid),
      ),
    ).toMatchObject({ code: 'RULE_DISABLED' });
    expect(
      await caught(() =>
        setup({ game: { ...baseGame, status: 'FINISHED' } }).service.placeBid('g', bid),
      ),
    ).toMatchObject({ code: 'GAME_FINISHED' });
    expect(
      await caught(() =>
        setup({ game: { ...baseGame, settings: null }, auctions: running() }).service.placeBid(
          'g',
          bid,
        ),
      ),
    ).toMatchObject({ code: 'RULE_DISABLED', details: { rule: 'auctions' } });
    expect(await caught(() => setup().service.placeBid('g', bid))).toMatchObject({
      code: 'AUCTION_NOT_FOUND',
      details: { auctionId: 'a1' },
    });
  });

  it('refuses a bidder who is not at the table', async () => {
    expect(
      await caught(() =>
        setup({ auctions: running() }).service.placeBid('g', { ...bid, bidderPlayerId: 'ghost' }),
      ),
    ).toMatchObject({ code: 'PLAYER_NOT_FOUND' });
  });

  it('writes the bid against the version it read, with the time and the extension floor', async () => {
    const { service, auctions } = setup({ auctions: running({ version: 4 }), now: START + 1000 });
    await service.placeBid('g', { ...bid, expectedVersion: 4 });
    expect(auctions.placeBid).toHaveBeenCalledWith({
      gameId: 'g',
      auctionId: 'a1',
      expectedVersion: 4,
      bid: 25,
      bidderPlayerId: 'p2',
      nowIso: '2026-01-01T00:00:01.000Z',
      minEndsAtIso: '2026-01-01T00:00:11.000Z',
    });
  });

  it('returns the stored auction after the bid', async () => {
    const { service, world } = setup({ auctions: running() });
    const result = await service.placeBid('g', bid);
    expect(result.auction).toBe(world.auctions.get('a1'));
  });

  it('counts the cash set aside for pending payment requests', async () => {
    const { service, auctions } = setup({ auctions: running(), reserved: 990 });
    expect(await caught(() => service.placeBid('g', bid))).toMatchObject({
      code: 'INSUFFICIENT_AVAILABLE_FUNDS',
      details: { playerId: 'p2', available: 10, required: 25 },
    });
    expect(auctions.placeBid).not.toHaveBeenCalled();
  });

  it('says the auction changed when the write lost a race against a newer version', async () => {
    const lost = setup({ auctions: running(), placeBidResult: false });
    const newer = auctionRow({ version: 2, currentBid: 10, currentBidderId: 'p1' });
    lost.auctions.getById.mockResolvedValueOnce(auctionRow()).mockResolvedValue(newer);
    expect(await caught(() => lost.service.placeBid('g', bid))).toMatchObject({
      code: 'AUCTION_BID_STALE',
      status: 409,
      details: { auction: newer },
    });
  });

  it('says the bidder already leads when their own earlier bid was written first', async () => {
    const lost = setup({ auctions: running(), placeBidResult: false });
    lost.auctions.getById
      .mockResolvedValueOnce(auctionRow())
      .mockResolvedValue(auctionRow({ currentBid: 25, currentBidderId: 'p2' }));
    expect(await caught(() => lost.service.placeBid('g', bid))).toMatchObject({
      code: 'AUCTION_ALREADY_LEADING',
      details: { playerId: 'p2' },
    });
  });

  it('still reports a changed auction when nothing else explains the refused write', async () => {
    const { service, world } = setup({ auctions: running(), placeBidResult: false });
    expect(await caught(() => service.placeBid('g', bid))).toMatchObject({
      code: 'AUCTION_BID_STALE',
      details: { auction: world.auctions.get('a1') },
    });
  });

  it('reports the real reason when the write is refused: closed, or the bidder spent the money', async () => {
    const closed = setup({ auctions: running(), placeBidResult: false });
    closed.auctions.getById
      .mockResolvedValueOnce(auctionRow())
      .mockResolvedValue(auctionRow({ state: 'SOLD' }));
    expect(await caught(() => closed.service.placeBid('g', bid))).toMatchObject({
      code: 'AUCTION_CLOSED',
    });

    const broke = setup({
      auctions: running(),
      placeBidResult: false,
      playerSnapshots: [
        [player('p1'), player('p2', 1000)],
        [player('p1'), player('p2', 10)],
      ],
    });
    expect(await caught(() => broke.service.placeBid('g', bid))).toMatchObject({
      code: 'INSUFFICIENT_AVAILABLE_FUNDS',
      details: { playerId: 'p2', available: 10, required: 25 },
    });
  });

  it('falls back to the bidder it already had when the fresh list no longer holds them', async () => {
    const { service } = setup({
      auctions: running(),
      placeBidResult: false,
      playerSnapshots: [[player('p1'), player('p2')], [player('p1')]],
    });
    expect(await caught(() => service.placeBid('g', bid))).toMatchObject({
      code: 'AUCTION_BID_STALE',
    });
  });
});

describe('settling a due auction', () => {
  const due = START + 31_000;
  const leading = (patch: Partial<Auction> = {}) =>
    new Map([['a1', auctionRow({ currentBid: 60, currentBidderId: 'p2', version: 3, ...patch })]]);

  it('refuses an unknown game or auction', async () => {
    expect(await caught(() => setup({ game: null }).service.settleDue('g', 'a1'))).toMatchObject({
      code: 'GAME_NOT_FOUND',
    });
    expect(await caught(() => setup().service.settleDue('g', 'a1'))).toMatchObject({
      code: 'AUCTION_NOT_FOUND',
      details: { auctionId: 'a1' },
    });
  });

  it('leaves a running auction alone and says it is not due', async () => {
    const { service, persist, auctions } = setup({ auctions: leading(), now: START + 29_999 });
    await expect(service.settleDue('g', 'a1')).resolves.toBeNull();
    expect(persist).not.toHaveBeenCalled();
    expect(auctions.closeWithoutSale).not.toHaveBeenCalled();
  });

  it('settles at exactly the end time', async () => {
    const { service, persist } = setup({ auctions: leading(), now: START + 30_000 });
    const result = await service.settleDue('g', 'a1');
    expect(persist).toHaveBeenCalledTimes(1);
    expect(result?.auction.state).toBe('SOLD');
  });

  it('closes without a sale when nobody bid, naming no transaction', async () => {
    const { service, auctions, persist } = setup({
      auctions: new Map([['a1', auctionRow({ version: 1 })]]),
      now: due,
    });
    const result = await service.settleDue('g', 'a1');
    expect(auctions.closeWithoutSale).toHaveBeenCalledWith('g', 'a1', 1);
    expect(persist).not.toHaveBeenCalled();
    expect(result).toEqual({ auction: expect.objectContaining({ state: 'NO_SALE' }) });
    expect(result).not.toHaveProperty('transaction');
  });

  it('sells to the leader in one guarded write that names the auction and its version', async () => {
    const { service, persist } = setup({ auctions: leading(), now: due });
    const result = await service.settleDue('g', 'a1');
    expect(persist).toHaveBeenCalledTimes(1);
    const input = persist.mock.calls[0]?.[0];
    expect(input?.transactionId).toBe('settlement-1');
    expect(input?.transaction).toMatchObject({
      type: 'AUCTION_PAYMENT',
      amount: 60,
      settlesAuction: { auctionId: 'a1', expectedVersion: 3 },
    });
    expect(input?.balanceChanges).toHaveLength(1);
    expect(result).toMatchObject({
      auction: { state: 'SOLD', settledTransactionId: 'settlement-1' },
      transaction: { id: 'settlement-1' },
      players: [{ id: 'p1' }, { id: 'p2' }],
    });
  });

  it('answers a sold auction without a settled transaction id with the auction alone', async () => {
    const { service } = setup({
      auctions: new Map([['a1', auctionRow({ state: 'SOLD', settledTransactionId: null })]]),
      now: due,
    });
    await expect(service.settleDue('g', 'a1')).resolves.toEqual({
      auction: expect.objectContaining({ state: 'SOLD' }),
    });
  });

  it('reports a settled transaction that cannot be found as a consistency failure', async () => {
    const { service } = setup({
      auctions: new Map([['a1', auctionRow({ state: 'SOLD', settledTransactionId: 'gone' })]]),
      now: due,
    });
    expect(await caught(() => service.settleDue('g', 'a1'))).toMatchObject({
      code: 'INTERNAL_ERROR',
    });
  });

  it('is idempotent: a closed auction is answered without writing again', async () => {
    const { service, persist, auctions } = setup({
      auctions: new Map([['a1', auctionRow({ state: 'NO_SALE' })]]),
      now: due,
    });
    await expect(service.settleDue('g', 'a1')).resolves.toMatchObject({
      auction: { state: 'NO_SALE' },
    });
    expect(persist).not.toHaveBeenCalled();
    expect(auctions.closeWithoutSale).not.toHaveBeenCalled();
  });

  it('accepts that a concurrent settlement won the write', async () => {
    const { service, world } = setup({
      auctions: leading(),
      now: due,
      persistError: new DatabaseError({ operation: 'persist', cause: new Error('guard') }),
    });
    const settled = auctionRow({ state: 'NO_SALE', version: 4 });
    const originalGet = world.auctions.get.bind(world.auctions);
    let reads = 0;
    world.auctions.get = (id: string) => {
      reads += 1;
      return reads >= 2 ? settled : originalGet(id);
    };
    await expect(service.settleDue('g', 'a1')).resolves.toMatchObject({
      auction: { state: 'NO_SALE' },
    });
  });

  it('rethrows a database error when the auction did not move on', async () => {
    const failure = new DatabaseError({ operation: 'persist', cause: new Error('disk') });
    const { service } = setup({ auctions: leading(), now: due, persistError: failure });
    expect(await caught(() => service.settleDue('g', 'a1'))).toBe(failure);
  });

  it('rethrows any other error even when the auction moved on', async () => {
    const failure = new Error('boom');
    const { service } = setup({ auctions: leading(), now: due, persistError: failure });
    expect(await caught(() => service.settleDue('g', 'a1'))).toBe(failure);
  });

  it('tries at most three times when the auction keeps moving without closing', async () => {
    const { service, persist, world } = setup({ auctions: leading(), now: due });
    persist.mockImplementation(async () => {
      const current = world.auctions.get('a1') as Auction;
      world.auctions.set('a1', { ...current, version: current.version + 1 });
    });
    await expect(service.settleDue('g', 'a1')).resolves.toBeNull();
    expect(persist).toHaveBeenCalledTimes(3);
  });

  it('settles a board tile auction against the registry', async () => {
    const boardGame: Game = { ...baseGame, settings: boardSettings, startingBalance: 15_000_000 };
    const tile = () => ({
      auctions: leading({ tileId: 'zhitna', currentBid: 600_000 }),
      now: due,
      game: boardGame,
      players: [player('p1', 15_000_000), player('p2', 15_000_000)],
    });
    const free = setup({ ...tile(), registry: [] });
    await free.service.settleDue('g', 'a1');
    expect(free.properties.listByGame).toHaveBeenCalledWith('g');
    expect(free.persist.mock.calls[0]?.[0].transaction).toMatchObject({
      type: 'PROPERTY_PURCHASE',
      tileId: 'zhitna',
    });
    const taken = setup({
      ...tile(),
      registry: [
        { gameId: 'g', tileId: 'zhitna', ownerPlayerId: 'p1', mortgaged: false, houses: 0 },
      ],
    });
    await taken.service.settleDue('g', 'a1');
    expect(taken.persist).not.toHaveBeenCalled();
    expect(taken.auctions.closeWithoutSale).toHaveBeenCalled();
  });

  it('does not read the registry for a free-text lot', async () => {
    const { service, properties } = setup({ auctions: leading(), now: due });
    await service.settleDue('g', 'a1');
    expect(properties.listByGame).not.toHaveBeenCalled();
  });
});
