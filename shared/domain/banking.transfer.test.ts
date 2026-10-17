import { describe, expect, it } from 'vitest';
import type { BoardSnapshot } from '../board/types.js';
import {
  defaultGameRules,
  type Game,
  type GameProperty,
  type Player,
  type Transaction,
} from '../types/monopoly.js';
import {
  InsufficientFundsError,
  InvalidAmountError,
  InvalidTradeError,
  mortgageTransferFee,
  PlayerBankruptError,
  ReversalBlockedByLaterOperationError,
  reverseTransaction,
  SameSourceAndDestinationError,
  transferProperties,
} from './banking.js';
import { buildGameSettings } from './game-rules.js';
import {
  PropertyHasBuildingsError,
  PropertyNotOwnedError,
  type PropertyContext,
} from './property.js';
import { findReversalDependency, reversalInitiatorPlayerId } from './reversal.js';

const settings = buildGameSettings(15_000_000, 'monopoly-ru-2012');
const board = settings.board as BoardSnapshot;
const game: Game = {
  id: 'game-1',
  name: 'Board game',
  startingBalance: 15_000_000,
  passGoReward: 2_000_000,
  currency: 'M',
  paymentMode: 'FAST',
  rules: defaultGameRules,
  settings,
  status: 'ACTIVE',
  createdAt: '',
  updatedAt: '',
};
const p1 = 'player-1';
const p2 = 'player-2';

function players(balances: readonly number[], bankrupt: readonly number[] = []): Player[] {
  return balances.map((balance, index) => ({
    id: `player-${index + 1}`,
    gameId: game.id,
    name: `Player ${index + 1}`,
    color: `color-${index + 1}`,
    balance,
    ...(bankrupt.includes(index) ? { status: 'BANKRUPT' as const } : {}),
    createdAt: '',
  }));
}

/** p1 owns zhitna, p2 owns riga_rail and kursk_rail; `extra` adjusts rows. */
function context(extra: Record<string, Partial<GameProperty>> = {}): PropertyContext {
  const owned: Record<string, Partial<GameProperty>> = {
    zhitna: { ownerPlayerId: p1 },
    riga_rail: { ownerPlayerId: p2 },
    kursk_rail: { ownerPlayerId: p2 },
  };
  for (const [tileId, values] of Object.entries(extra))
    owned[tileId] = { ...owned[tileId], ...values };
  return {
    board,
    registry: board.tiles.map((tile) => ({
      gameId: game.id,
      tileId: tile.id,
      ownerPlayerId: null,
      mortgaged: false,
      houses: 0,
      ...owned[tile.id],
    })),
  };
}

const trade = (
  overrides: Partial<Parameters<typeof transferProperties>[0]> = {},
  balances: readonly number[] = [1_000_000, 1_000_000],
) =>
  transferProperties({
    game,
    players: players(balances),
    playerId: p1,
    counterpartyPlayerId: p2,
    giveTileIds: ['zhitna'],
    takeTileIds: ['riga_rail'],
    cashGive: 0,
    cashTake: 0,
    property: context(),
    ...overrides,
  });

const fee = mortgageTransferFee(board, 'zhitna');

describe('a property trade', () => {
  it('swaps two tiles with no money: both traders are recorded with zero deltas', () => {
    const { transaction } = trade();
    expect(transaction).toMatchObject({
      type: 'PROPERTY_TRANSFER',
      amount: 0,
      totalAmount: 0,
      initiatorPlayerId: p1,
      participants: [
        { playerId: p1, balanceDelta: 0 },
        { playerId: p2, balanceDelta: 0 },
      ],
    });
    expect(
      transaction.registryChanges?.map((change) => [change.tileId, change.after.ownerPlayerId]),
    ).toEqual([
      ['zhitna', p2],
      ['riga_rail', p1],
    ]);
  });

  it('is a gift when one side gives nothing', () => {
    const { transaction } = trade({ takeTileIds: [] });
    expect(transaction.registryChanges).toHaveLength(1);
    expect(transaction.amount).toBe(0);
  });

  it('adds cash each way and records the net as the amount', () => {
    const { transaction } = trade({ cashGive: 300_000, cashTake: 100_000 });
    expect(transaction).toMatchObject({ amount: 200_000, totalAmount: 200_000 });
    expect(transaction.participants).toEqual([
      { playerId: p1, balanceDelta: -200_000 },
      { playerId: p2, balanceDelta: 200_000 },
    ]);
  });

  it('charges the receiver 10% of the mortgage value for a mortgaged tile; it stays mortgaged', () => {
    expect(fee).toBe(30_000);
    const given = trade({ property: context({ zhitna: { mortgaged: true } }) });
    expect(given.transaction.participants).toEqual([
      { playerId: p1, balanceDelta: 0 },
      { playerId: p2, balanceDelta: -fee },
    ]);
    expect(given.transaction.registryChanges?.[0]?.after).toEqual({
      ownerPlayerId: p2,
      mortgaged: true,
      houses: 0,
    });
    const taken = trade({ property: context({ riga_rail: { mortgaged: true } }) });
    expect(taken.transaction.participants[0]?.balanceDelta).toBe(
      -mortgageTransferFee(board, 'riga_rail'),
    );
  });

  it('refuses when the receiver cannot pay the fee, and writes nothing', () => {
    expect(() =>
      trade({ property: context({ zhitna: { mortgaged: true } }) }, [1_000_000, fee - 1]),
    ).toThrow(InsufficientFundsError);
    expect(() => trade({ cashGive: 2_000_000 })).toThrow(InsufficientFundsError);
  });

  it('refuses tiles the named player does not own', () => {
    expect(() => trade({ giveTileIds: ['riga_rail'], takeTileIds: [] })).toThrow(
      PropertyNotOwnedError,
    );
    expect(() => trade({ giveTileIds: [], takeTileIds: ['zhitna'] })).toThrow(
      PropertyNotOwnedError,
    );
    expect(() => trade({ giveTileIds: ['nagatinska'] })).toThrow(PropertyNotOwnedError);
  });

  it('refuses tiles of a colour group that has buildings', () => {
    expect(() =>
      trade({
        property: context({
          zhitna: { houses: 1 },
          nagatinska: { ownerPlayerId: p1, houses: 1 },
        }),
      }),
    ).toThrow(PropertyHasBuildingsError);
  });

  it('refuses an empty trade, a repeated tile, bad cash and the same player', () => {
    expect(() => trade({ giveTileIds: [], takeTileIds: [] })).toThrow(InvalidTradeError);
    expect(() => trade({ giveTileIds: ['zhitna', 'zhitna'] })).toThrow(InvalidTradeError);
    expect(() => trade({ cashGive: -1 })).toThrow(InvalidAmountError);
    expect(() => trade({ cashTake: 1.5 })).toThrow(InvalidAmountError);
    expect(() => trade({ counterpartyPlayerId: p1 })).toThrow(SameSourceAndDestinationError);
  });

  it('refuses a bankrupt trader', () => {
    expect(() =>
      transferProperties({
        game,
        players: players([1_000_000, 1_000_000], [1]),
        playerId: p1,
        counterpartyPlayerId: p2,
        giveTileIds: ['zhitna'],
        takeTileIds: [],
        cashGive: 0,
        cashTake: 0,
        property: context(),
      }),
    ).toThrow(PlayerBankruptError);
  });
});

describe('reversing a trade', () => {
  const original: Transaction = {
    id: 'tx-trade',
    gameId: game.id,
    type: 'PROPERTY_TRANSFER',
    amount: 200_000,
    totalAmount: 200_000,
    comment: null,
    createdAt: '',
    initiatorPlayerId: p1,
    tileIds: ['zhitna', 'riga_rail'],
    participants: [
      { playerId: p1, balanceDelta: -200_000 },
      { playerId: p2, balanceDelta: 200_000 },
    ],
  };
  const changes = [
    {
      tileId: 'zhitna',
      before: { ownerPlayerId: p1, mortgaged: false, houses: 0 },
      after: { ownerPlayerId: p2, mortgaged: false, houses: 0 },
    },
    {
      tileId: 'riga_rail',
      before: { ownerPlayerId: p2, mortgaged: false, houses: 0 },
      after: { ownerPlayerId: p1, mortgaged: false, houses: 0 },
    },
  ];

  it('restores the exact deltas and hands every tile back', () => {
    const { transaction } = reverseTransaction({
      game,
      players: players([1_000_000, 1_000_000]),
      original,
      originalRegistryChanges: changes,
    });
    expect(transaction.participants).toEqual([
      { playerId: p1, balanceDelta: 200_000 },
      { playerId: p2, balanceDelta: -200_000 },
    ]);
    expect(
      transaction.registryChanges?.map((change) => [change.tileId, change.after.ownerPlayerId]),
    ).toEqual([
      ['zhitna', p1],
      ['riga_rail', p2],
    ]);
  });

  it('can reverse a zero-money swap and cannot without its registry changes', () => {
    const swap: Transaction = {
      ...original,
      amount: 0,
      totalAmount: 0,
      participants: [
        { playerId: p1, balanceDelta: 0 },
        { playerId: p2, balanceDelta: 0 },
      ],
    };
    expect(
      reverseTransaction({
        game,
        players: players([1_000_000, 1_000_000]),
        original: swap,
        originalRegistryChanges: changes,
      }).transaction.participants,
    ).toEqual([
      { playerId: p1, balanceDelta: 0 },
      { playerId: p2, balanceDelta: 0 },
    ]);
    expect(() =>
      reverseTransaction({ game, players: players([1_000_000, 1_000_000]), original: swap }),
    ).toThrow();
  });

  it('is refused when the receiver no longer holds the cash', () => {
    expect(() =>
      reverseTransaction({
        game,
        players: players([1_000_000, 100_000]),
        original,
        originalRegistryChanges: changes,
      }),
    ).toThrow(InsufficientFundsError);
  });

  it('names the initiator and is blocked by later operations on either tile or its group', () => {
    expect(reversalInitiatorPlayerId(original)).toBe(p1);
    const later = (type: Transaction['type'], tileId: string): Transaction => ({
      ...original,
      id: `later-${type}-${tileId}`,
      type,
      tileId,
      tileIds: undefined,
      participants: [{ playerId: 'other', balanceDelta: 1 }],
    });
    const mortgage = later('MORTGAGE', 'riga_rail');
    expect(findReversalDependency(original, [mortgage])).toBe(mortgage);
    const nextTrade: Transaction = {
      ...later('PROPERTY_TRANSFER', 'x'),
      tileId: null,
      tileIds: ['zhitna'],
    };
    expect(findReversalDependency(original, [nextTrade])).toBe(nextTrade);
    const rent = later('PAY_RENT', 'nagatinska');
    expect(findReversalDependency(original, [rent])).toBeNull();
    expect(findReversalDependency(original, [rent], ['zhitna', 'nagatinska'])).toBe(rent);
    expect(() =>
      reverseTransaction({
        game,
        players: players([1_000_000, 1_000_000]),
        original,
        originalRegistryChanges: changes,
        later: [mortgage],
      }),
    ).toThrow(ReversalBlockedByLaterOperationError);
  });

  it('is blocked by a later trade of a tile, by anyone', () => {
    // A trade of the tile in question is a registry operation on it, also from the other direction.
    const earlierMortgage: Transaction = {
      ...original,
      id: 'm',
      type: 'MORTGAGE',
      tileId: 'zhitna',
      tileIds: undefined,
    };
    const laterTrade: Transaction = { ...original, id: 't2' };
    expect(findReversalDependency(earlierMortgage, [laterTrade])).toBe(laterTrade);
  });
});
