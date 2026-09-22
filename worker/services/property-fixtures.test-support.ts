import { vi } from 'vitest';
import type { PaymentRequest, PropertyStateResponse } from '../../shared/contracts/api.js';
import type { BoardSpace, Game, GameProperty, Player, Transaction } from '../../shared/types/monopoly.js';
import type { PersistBankingOperationInput } from '../repositories/banking-operation-repository.js';

/**
 * A small in-memory world for the property services: an active two-player game
 * on a four-space board (a brown pair, one railroad, one utility). `persist`
 * applies the batch to the in-memory rows the way D1 would, so a test can read
 * the state back through the same fakes the service uses.
 */
export const gameId = '00000000-0000-4000-8000-0000000000a1';
export const ada = '00000000-0000-4000-8000-0000000000b1';
export const lin = '00000000-0000-4000-8000-0000000000b2';
export const brownOne = 'board-classic-space-01';
export const brownTwo = 'board-classic-space-03';
export const railroad = 'board-classic-space-05';
export const utility = 'board-classic-space-12';

export const board = { id: 'board-classic', name: 'Classic', jailFee: 50, unmortgageInterestPercent: 10, houseBankLimit: 32, hotelBankLimit: 12, utilityMultiplierSingle: 4, utilityMultiplierPair: 10 };

export const spaces: BoardSpace[] = [
  { id: brownOne, boardIndex: 1, kind: 'STREET', colorGroup: 'BROWN', translationKey: 'boardSpaceMediterraneanAvenue', customName: null, price: 60, mortgageValue: 30, houseCost: 50, rents: [2, 10, 30, 90, 160, 250] },
  { id: brownTwo, boardIndex: 3, kind: 'STREET', colorGroup: 'BROWN', translationKey: 'boardSpaceBalticAvenue', customName: null, price: 60, mortgageValue: 30, houseCost: 50, rents: [4, 20, 60, 180, 320, 450] },
  { id: railroad, boardIndex: 5, kind: 'RAILROAD', colorGroup: 'RAILROAD', translationKey: 'boardSpaceReadingRailroad', customName: null, price: 200, mortgageValue: 100, houseCost: null, rents: [25, 50, 100, 200] },
  { id: utility, boardIndex: 12, kind: 'UTILITY', colorGroup: 'UTILITY', translationKey: 'boardSpaceElectricCompany', customName: null, price: 150, mortgageValue: 75, houseCost: null, rents: [] },
];

export function makeGame(overrides: Partial<Game> = {}): Game {
  return { id: gameId, name: 'Table', startingBalance: 1500, passGoReward: 200, currency: 'USD', paymentMode: 'FAST', status: 'ACTIVE', createdAt: '', updatedAt: '', boardId: board.id, ...overrides };
}

export function makePlayers(overrides: { ada?: Partial<Player>; lin?: Partial<Player> } = {}): Player[] {
  return [
    { id: ada, gameId, name: 'Ada', color: '#1', balance: 1500, status: 'ACTIVE', isInJail: false, consecutiveDoubles: 0, lastRollTotal: null, createdAt: '', ...overrides.ada },
    { id: lin, gameId, name: 'Lin', color: '#2', balance: 1500, status: 'ACTIVE', isInJail: false, consecutiveDoubles: 0, lastRollTotal: null, createdAt: '', ...overrides.lin },
  ];
}

export function makeProperties(owned: Partial<Record<string, Partial<GameProperty>>> = {}): GameProperty[] {
  return spaces.map((space) => ({ boardSpaceId: space.id, ownerPlayerId: null, houses: 0, mortgaged: false, ...owned[space.id] }));
}

export interface World {
  game: Game;
  players: Player[];
  slice: PropertyStateResponse;
  transactions: Map<string, Transaction>;
  paymentRequests: Map<string, PaymentRequest>;
  persist: ReturnType<typeof vi.fn<(input: PersistBankingOperationInput) => Promise<void>>>;
  ids: string[];
  /** A test's hook for the trade-settlement statement, which lives in the trade repository fake. */
  settleTrade?: (tradeId: string, transactionId: string) => void;
  /** The service dependencies, typed loosely: every fake implements exactly what the services call. */
  dependencies: {
    games: { getById: (id: string) => Promise<Game | null> };
    players: { listByGameId: () => Promise<Player[]>; updateGameplayState: ReturnType<typeof vi.fn> };
    properties: { loadPropertySlice: (id: string) => Promise<PropertyStateResponse | null>; listProperties: () => Promise<GameProperty[]> };
    transactions: { getById: (gameId: string, id: string) => Promise<Transaction | null> };
    operations: { persist: (input: PersistBankingOperationInput) => Promise<void> };
    paymentRequests: { create: (input: Omit<PaymentRequest, 'createdAt' | 'resolvedAt' | 'transactionId'>) => Promise<void>; getById: (gameId: string, id: string) => Promise<PaymentRequest | null>; pendingReservedAmount: () => Promise<number>; expirePending: () => Promise<void>; settle: ReturnType<typeof vi.fn>; listForPayers: () => Promise<PaymentRequest[]>; resolve: () => Promise<boolean> };
    createId: () => string;
    now: () => Date;
  };
}

export function makeWorld(options: { game?: Partial<Game>; players?: { ada?: Partial<Player>; lin?: Partial<Player> }; properties?: Partial<Record<string, Partial<GameProperty>>>; buildingBank?: { housesAvailable: number; hotelsAvailable: number }; ids?: string[] } = {}): World {
  const game = makeGame(options.game);
  const players = makePlayers(options.players);
  const slice: PropertyStateResponse = { board, boardSpaces: spaces, properties: makeProperties(options.properties), buildingBank: options.buildingBank ?? { housesAvailable: 32, hotelsAvailable: 12 } };
  const transactions = new Map<string, Transaction>();
  const paymentRequests = new Map<string, PaymentRequest>();
  const ids = [...(options.ids ?? ['00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000c3'])];

  const persist = vi.fn(async (input: PersistBankingOperationInput) => {
    for (const write of input.propertyChanges ?? []) {
      const row = slice.properties.find((property) => property.boardSpaceId === write.change.boardSpaceId);
      if (row === undefined || row.ownerPlayerId !== write.previous.ownerPlayerId || row.houses !== write.previous.houses || row.mortgaged !== write.previous.mortgaged) throw new Error('stale deed');
      Object.assign(row, write.change);
    }
    if (input.buildingBankDelta !== undefined) { slice.buildingBank.housesAvailable += input.buildingBankDelta.houses; slice.buildingBank.hotelsAvailable += input.buildingBankDelta.hotels; }
    if (input.jailChange !== undefined) { const player = players.find((candidate) => candidate.id === input.jailChange?.playerId); if (player !== undefined) player.isInJail = input.jailChange.isInJail; }
    for (const change of input.balanceChanges) { const player = players.find((candidate) => candidate.id === change.player.id); if (player !== undefined) player.balance = change.balanceAfter; }
    if (input.paymentRequestSettlement !== undefined) { const request = paymentRequests.get(input.paymentRequestSettlement.requestId); if (request !== undefined) paymentRequests.set(request.id, { ...request, state: 'ACCEPTED', transactionId: input.transactionId }); }
    if (input.tradeSettlement !== undefined) world.settleTrade?.(input.tradeSettlement.tradeId, input.transactionId);
    transactions.set(input.transactionId, { id: input.transactionId, gameId: input.transaction.gameId, type: input.transaction.type, amount: input.transaction.amount, totalAmount: input.transaction.totalAmount, comment: input.transaction.comment, createdAt: '2026-01-01T00:00:00Z', participants: input.transaction.participants });
  });

  const dependencies: World['dependencies'] = {
    games: { getById: async (id) => (id === game.id ? game : null) },
    players: { listByGameId: async () => players.map((player) => ({ ...player })), updateGameplayState: vi.fn(async (playerId: string, input: Partial<Player>) => { const player = players.find((candidate) => candidate.id === playerId); if (player === undefined) return null; Object.assign(player, input); return { ...player }; }) },
    properties: { loadPropertySlice: async (id) => (id === game.id && game.boardId ? structuredClone(slice) : null), listProperties: async () => structuredClone(slice.properties) },
    transactions: { getById: async (_gameId, id) => transactions.get(id) ?? null },
    operations: { persist },
    paymentRequests: {
      create: async (input) => { if (!paymentRequests.has(input.id)) paymentRequests.set(input.id, { ...input, createdAt: '2026-01-01T00:00:00Z', resolvedAt: null, transactionId: null }); },
      getById: async (_gameId, id) => paymentRequests.get(id) ?? null,
      pendingReservedAmount: async () => 0,
      expirePending: async () => undefined,
      settle: vi.fn(),
      listForPayers: async () => [],
      resolve: async () => true,
    },
    createId: () => ids.shift() ?? crypto.randomUUID(),
    now: () => new Date('2026-06-01T12:00:00.000Z'),
  };

  const world: World = { game, players, slice, transactions, paymentRequests, persist, ids, dependencies };
  return world;
}
