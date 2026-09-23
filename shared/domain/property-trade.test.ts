import { describe, expect, it } from 'vitest';

import {
  applyTrade,
  MortgageResolutionRequiredError,
  proposeTrade,
  recordAuctionResult,
  TradeEmptyError,
  TradePartyMismatchError,
  TradePropertyNotOwnedError,
  TradeStateChangedError,
  type TradeProposal,
} from './property-trade.js';
import { InsufficientFundsError, SameSourceAndDestinationError } from './banking.js';
import { PropertyAlreadyOwnedError, type PropertyOperationResult } from './property.js';
import type { BoardDefinition, BoardSpace, BuildingBank, Game, GameProperty, Player } from '../types/monopoly.js';

const game: Game = {
  id: 'game-1',
  name: 'Friday game',
  startingBalance: 1500,
  passGoReward: 200,
  currency: 'UAH',
  paymentMode: 'FAST',
  status: 'ACTIVE',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const board: BoardDefinition = {
  id: 'board-classic',
  name: 'Classic',
  jailFee: 50,
  unmortgageInterestPercent: 10,
  houseBankLimit: 32,
  hotelBankLimit: 12,
  utilityMultiplierSingle: 4,
  utilityMultiplierPair: 10,
};

const spaces: BoardSpace[] = [
  street('board-classic-space-01', 1, 'BROWN', 60, 30, 50, [2, 10, 30, 90, 160, 250]),
  street('board-classic-space-03', 3, 'BROWN', 60, 30, 50, [4, 20, 60, 180, 320, 450]),
  street('board-classic-space-06', 6, 'LIGHT_BLUE', 100, 50, 50, [6, 30, 90, 270, 400, 550]),
  street('board-classic-space-08', 8, 'LIGHT_BLUE', 100, 50, 50, [6, 30, 90, 270, 400, 550]),
  railroad('board-classic-space-05', 5),
  utility('board-classic-space-12', 12),
];

function street(
  id: string,
  boardIndex: number,
  colorGroup: BoardSpace['colorGroup'],
  price: number,
  mortgageValue: number,
  houseCost: number,
  rents: number[],
): BoardSpace {
  return { id, boardIndex, kind: 'STREET', colorGroup, translationKey: id, customName: null, price, mortgageValue, houseCost, rents };
}

function railroad(id: string, boardIndex: number): BoardSpace {
  return { id, boardIndex, kind: 'RAILROAD', colorGroup: 'RAILROAD', translationKey: id, customName: null, price: 200, mortgageValue: 100, houseCost: null, rents: [25, 50, 100, 200] };
}

function utility(id: string, boardIndex: number): BoardSpace {
  return { id, boardIndex, kind: 'UTILITY', colorGroup: 'UTILITY', translationKey: id, customName: null, price: 150, mortgageValue: 75, houseCost: null, rents: [] };
}

function createPlayers(balances: readonly number[] = [1500, 1500]): Player[] {
  return balances.map((balance, index) => ({
    id: `player-${index + 1}`,
    gameId: game.id,
    name: `Player ${index + 1}`,
    color: `color-${index + 1}`,
    balance,
    createdAt: '2026-01-01T00:00:00.000Z',
  }));
}

function owned(
  boardSpaceId: string,
  ownerPlayerId: string,
  overrides: Partial<Pick<GameProperty, 'houses' | 'mortgaged'>> = {},
): GameProperty {
  return { boardSpaceId, ownerPlayerId, houses: overrides.houses ?? 0, mortgaged: overrides.mortgaged ?? false };
}

const fullBank: BuildingBank = { housesAvailable: 32, hotelsAvailable: 12 };

function command(properties: GameProperty[], players: Player[] = createPlayers(), buildingBank: BuildingBank = fullBank) {
  return { game, players, board, spaces, properties, buildingBank };
}

function balancesAfter(result: PropertyOperationResult): Array<[string, number]> {
  return result.affectedPlayers.map((change) => [change.player.id, change.balanceAfter]);
}

describe('proposing a trade', () => {
  it('records the deed state the offer was made against and moves no money', () => {
    const players = createPlayers();
    const properties = [owned('board-classic-space-01', 'player-1', { houses: 2 })];

    const proposal = proposeTrade({
      ...command(properties, players),
      proposerPlayerId: 'player-1',
      responderPlayerId: 'player-2',
      propertiesFromProposer: [{ boardSpaceId: 'board-classic-space-01' }],
      cashFromResponder: 200,
    });

    expect(proposal).toEqual({
      gameId: 'game-1',
      proposerPlayerId: 'player-1',
      responderPlayerId: 'player-2',
      cashFromProposer: 0,
      cashFromResponder: 200,
      items: [
        {
          boardSpaceId: 'board-classic-space-01',
          fromPlayerId: 'player-1',
          mortgageResolution: null,
          recordedState: { ownerPlayerId: 'player-1', houses: 2, mortgaged: false },
        },
      ],
    });
    expect(players.map((player) => player.balance)).toEqual([1500, 1500]);
  });

  it('refuses a deed the offering side does not own', () => {
    const properties = [owned('board-classic-space-01', 'player-2')];

    expect(() =>
      proposeTrade({
        ...command(properties),
        proposerPlayerId: 'player-1',
        responderPlayerId: 'player-2',
        propertiesFromProposer: [{ boardSpaceId: 'board-classic-space-01' }],
      }),
    ).toThrow(TradePropertyNotOwnedError);
  });

  it('refuses a trade with the same player on both sides', () => {
    expect(() =>
      proposeTrade({
        ...command([]),
        proposerPlayerId: 'player-1',
        responderPlayerId: 'player-1',
        cashFromProposer: 10,
      }),
    ).toThrow(SameSourceAndDestinationError);
  });

  it('refuses the same deed listed twice on one side', () => {
    const properties = [owned('board-classic-space-01', 'player-1')];

    expect(() =>
      proposeTrade({
        ...command(properties),
        proposerPlayerId: 'player-1',
        responderPlayerId: 'player-2',
        propertiesFromProposer: [{ boardSpaceId: 'board-classic-space-01' }, { boardSpaceId: 'board-classic-space-01' }],
      }),
    ).toThrow(TradePartyMismatchError);
  });

  it('drops a mortgage resolution offered for a deed that is not mortgaged', () => {
    const properties = [owned('board-classic-space-01', 'player-1')];

    const proposal = proposeTrade({
      ...command(properties),
      proposerPlayerId: 'player-1',
      responderPlayerId: 'player-2',
      propertiesFromProposer: [{ boardSpaceId: 'board-classic-space-01', mortgageResolution: 'REDEEM' }],
    });

    expect(proposal.items[0].mortgageResolution).toBeNull();
  });
});

describe('a deed for cash', () => {
  it('moves the deed and the money in one PROPERTY_TRADE operation', () => {
    const players = createPlayers();
    const properties = [owned('board-classic-space-01', 'player-1')];
    const base = command(properties, players);
    const proposal = proposeTrade({
      ...base,
      proposerPlayerId: 'player-1',
      responderPlayerId: 'player-2',
      propertiesFromProposer: [{ boardSpaceId: 'board-classic-space-01' }],
      cashFromResponder: 200,
    });

    const result = applyTrade({ ...base, proposal });

    expect(result.transaction).toEqual({
      gameId: 'game-1',
      type: 'PROPERTY_TRADE',
      amount: 200,
      totalAmount: 200,
      comment: null,
      participants: [
        { playerId: 'player-1', balanceDelta: 200 },
        { playerId: 'player-2', balanceDelta: -200 },
      ],
    });
    expect(balancesAfter(result)).toEqual([['player-1', 1700], ['player-2', 1300]]);
    expect(result.propertyChanges).toEqual([
      { boardSpaceId: 'board-classic-space-01', ownerPlayerId: 'player-2', houses: 0, mortgaged: false },
    ]);
    expect(result.buildingBankDelta).toEqual({ houses: 0, hotels: 0 });
    expect(players.map((player) => player.balance)).toEqual([1500, 1500]);
  });

  it('records a deed-for-deed swap that moves no cash at all', () => {
    const properties = [owned('board-classic-space-01', 'player-1'), owned('board-classic-space-06', 'player-2')];
    const base = command(properties);
    const proposal = proposeTrade({
      ...base,
      proposerPlayerId: 'player-1',
      responderPlayerId: 'player-2',
      propertiesFromProposer: [{ boardSpaceId: 'board-classic-space-01' }],
      propertiesFromResponder: [{ boardSpaceId: 'board-classic-space-06' }],
    });

    const result = applyTrade({ ...base, proposal });

    expect(result.transaction).toMatchObject({ type: 'PROPERTY_TRADE', amount: 1, totalAmount: 1, participants: [] });
    expect(result.propertyChanges).toEqual([
      { boardSpaceId: 'board-classic-space-01', ownerPlayerId: 'player-2', houses: 0, mortgaged: false },
      { boardSpaceId: 'board-classic-space-06', ownerPlayerId: 'player-1', houses: 0, mortgaged: false },
    ]);
  });

  it('records what moved, not the gross, when equal cash offers cancel each other out', () => {
    const base = command([]);
    const proposal = proposeTrade({
      ...base,
      proposerPlayerId: 'player-1',
      responderPlayerId: 'player-2',
      cashFromProposer: 100,
      cashFromResponder: 100,
    });

    const result = applyTrade({ ...base, proposal });

    // Nobody's balance moves, so the ledger must not claim 200 changed hands: a
    // transaction with no participant rows is the same nominal 1 a deed swap gets.
    expect(result.transaction).toMatchObject({ type: 'PROPERTY_TRADE', amount: 1, totalAmount: 1, participants: [] });
    expect(balancesAfter(result)).toEqual([]);
  });

  it('records only the cash that actually crossed when the offers are unequal', () => {
    const base = command([]);
    const proposal = proposeTrade({
      ...base,
      proposerPlayerId: 'player-1',
      responderPlayerId: 'player-2',
      cashFromProposer: 120,
      cashFromResponder: 100,
    });

    const result = applyTrade({ ...base, proposal });

    expect(result.transaction).toMatchObject({ type: 'PROPERTY_TRADE', amount: 20, totalAmount: 20 });
    expect(balancesAfter(result)).toEqual([['player-1', 1480], ['player-2', 1520]]);
  });
});

describe('buildings on a traded deed', () => {
  it('sells them to the bank at half price, paying the giver and returning the houses', () => {
    const properties = [
      owned('board-classic-space-01', 'player-1', { houses: 3 }),
      owned('board-classic-space-03', 'player-1', { houses: 3 }),
    ];
    const base = command(properties);
    const proposal = proposeTrade({
      ...base,
      proposerPlayerId: 'player-1',
      responderPlayerId: 'player-2',
      propertiesFromProposer: [{ boardSpaceId: 'board-classic-space-01' }],
      cashFromResponder: 100,
    });

    const result = applyTrade({ ...base, proposal });

    // 3 houses x floor(50 / 2) = 75 to the giver, on top of the 100 cash.
    expect(balancesAfter(result)).toEqual([['player-1', 1675], ['player-2', 1400]]);
    expect(result.transaction).toMatchObject({ type: 'PROPERTY_TRADE', amount: 175, totalAmount: 175 });
    expect(result.propertyChanges).toEqual([
      { boardSpaceId: 'board-classic-space-01', ownerPlayerId: 'player-2', houses: 0, mortgaged: false },
    ]);
    expect(result.buildingBankDelta).toEqual({ houses: 3, hotels: 0 });
  });

  it('returns a hotel rather than five houses, and pays for all five buildings', () => {
    const properties = [
      owned('board-classic-space-01', 'player-1', { houses: 5 }),
      owned('board-classic-space-03', 'player-1', { houses: 4 }),
    ];
    const base = command(properties);
    const proposal = proposeTrade({
      ...base,
      proposerPlayerId: 'player-1',
      responderPlayerId: 'player-2',
      propertiesFromProposer: [{ boardSpaceId: 'board-classic-space-01' }],
    });

    const result = applyTrade({ ...base, proposal });

    expect(balancesAfter(result)).toEqual([['player-1', 1625]]);
    expect(result.buildingBankDelta).toEqual({ houses: 0, hotels: 1 });
  });
});

describe('a mortgaged deed in a trade', () => {
  const mortgagedUtility = (): GameProperty[] => [owned('board-classic-space-12', 'player-1', { mortgaged: true })];

  it('refuses the offer without a mortgage resolution', () => {
    expect(() =>
      proposeTrade({
        ...command(mortgagedUtility()),
        proposerPlayerId: 'player-1',
        responderPlayerId: 'player-2',
        propertiesFromProposer: [{ boardSpaceId: 'board-classic-space-12' }],
      }),
    ).toThrow(MortgageResolutionRequiredError);
  });

  it('charges the receiver the interest alone and keeps the deed mortgaged on PAY_INTEREST', () => {
    const base = command(mortgagedUtility());
    const proposal = proposeTrade({
      ...base,
      proposerPlayerId: 'player-1',
      responderPlayerId: 'player-2',
      propertiesFromProposer: [{ boardSpaceId: 'board-classic-space-12', mortgageResolution: 'PAY_INTEREST' }],
    });

    const result = applyTrade({ ...base, proposal });

    // 75 mortgage, 10% interest rounded up: 83 to redeem, so 8 of interest.
    expect(balancesAfter(result)).toEqual([['player-2', 1492]]);
    expect(result.transaction).toMatchObject({ type: 'PROPERTY_TRADE', amount: 8, totalAmount: 8 });
    expect(result.propertyChanges).toEqual([
      { boardSpaceId: 'board-classic-space-12', ownerPlayerId: 'player-2', houses: 0, mortgaged: true },
    ]);
  });

  it('charges the receiver the mortgage plus interest and clears it on REDEEM', () => {
    const base = command(mortgagedUtility());
    const proposal = proposeTrade({
      ...base,
      proposerPlayerId: 'player-1',
      responderPlayerId: 'player-2',
      propertiesFromProposer: [{ boardSpaceId: 'board-classic-space-12', mortgageResolution: 'REDEEM' }],
    });

    const result = applyTrade({ ...base, proposal });

    expect(balancesAfter(result)).toEqual([['player-2', 1417]]);
    expect(result.transaction).toMatchObject({ type: 'PROPERTY_TRADE', amount: 83, totalAmount: 83 });
    expect(result.propertyChanges).toEqual([
      { boardSpaceId: 'board-classic-space-12', ownerPlayerId: 'player-2', houses: 0, mortgaged: false },
    ]);
  });
});

describe('a trade the world moved under', () => {
  function staleProposal(): { proposal: TradeProposal } {
    const properties = [owned('board-classic-space-01', 'player-1'), owned('board-classic-space-06', 'player-2')];
    return {
      proposal: proposeTrade({
        ...command(properties),
        proposerPlayerId: 'player-1',
        responderPlayerId: 'player-2',
        propertiesFromProposer: [{ boardSpaceId: 'board-classic-space-01' }],
        propertiesFromResponder: [{ boardSpaceId: 'board-classic-space-06' }],
      }),
    };
  }

  it.each([
    ['a deed was mortgaged', [owned('board-classic-space-01', 'player-1'), owned('board-classic-space-06', 'player-2', { mortgaged: true })]],
    ['a deed was built on', [owned('board-classic-space-01', 'player-1', { houses: 1 }), owned('board-classic-space-06', 'player-2')]],
    ['a deed changed hands', [owned('board-classic-space-01', 'player-2'), owned('board-classic-space-06', 'player-2')]],
  ])('refuses the whole trade and applies nothing when %s', (_reason, current) => {
    const { proposal } = staleProposal();
    const players = createPlayers();
    let result: PropertyOperationResult | null = null;

    expect(() => {
      result = applyTrade({ ...command(current, players), proposal });
    }).toThrow(TradeStateChangedError);
    expect(result).toBeNull();
    expect(players.map((player) => player.balance)).toEqual([1500, 1500]);
  });
});

describe('a trade that cannot be afforded', () => {
  it('refuses an empty trade before anything else', () => {
    expect(() =>
      proposeTrade({ ...command([]), proposerPlayerId: 'player-1', responderPlayerId: 'player-2' }),
    ).toThrow(TradeEmptyError);
  });

  it('refuses when either side cannot cover its net outflow', () => {
    const properties = [owned('board-classic-space-01', 'player-1')];
    const base = command(properties, createPlayers([1500, 150]));
    const proposal = proposeTrade({
      ...base,
      proposerPlayerId: 'player-1',
      responderPlayerId: 'player-2',
      propertiesFromProposer: [{ boardSpaceId: 'board-classic-space-01' }],
      cashFromResponder: 200,
    });

    expect(() => applyTrade({ ...base, proposal })).toThrow(InsufficientFundsError);
  });

  it('accepts a side that can only pay because of what the same trade hands it', () => {
    // player-2 has nothing, owes 8 of mortgage interest, and is paid 50 for the
    // two houses the trade sells off the deed they give away. The funds check has
    // to run after both, or a solvent trade would be refused.
    const properties = [
      owned('board-classic-space-12', 'player-1', { mortgaged: true }),
      owned('board-classic-space-06', 'player-2', { houses: 2 }),
      owned('board-classic-space-08', 'player-2', { houses: 2 }),
    ];
    const base = command(properties, createPlayers([1500, 0]));
    const proposal = proposeTrade({
      ...base,
      proposerPlayerId: 'player-1',
      responderPlayerId: 'player-2',
      propertiesFromProposer: [{ boardSpaceId: 'board-classic-space-12', mortgageResolution: 'PAY_INTEREST' }],
      propertiesFromResponder: [{ boardSpaceId: 'board-classic-space-06' }],
    });

    const result = applyTrade({ ...base, proposal });

    expect(balancesAfter(result)).toEqual([['player-2', 42]]);
    expect(result.transaction).toMatchObject({ type: 'PROPERTY_TRADE', amount: 58, totalAmount: 58 });
    expect(result.buildingBankDelta).toEqual({ houses: 2, hotels: 0 });
  });
});

describe('a proposal that does not belong to its parties', () => {
  it('refuses an item offered by someone outside the trade', () => {
    const proposal: TradeProposal = {
      gameId: 'game-1',
      proposerPlayerId: 'player-1',
      responderPlayerId: 'player-2',
      cashFromProposer: 0,
      cashFromResponder: 0,
      items: [
        {
          boardSpaceId: 'board-classic-space-01',
          fromPlayerId: 'player-3',
          mortgageResolution: null,
          recordedState: { ownerPlayerId: 'player-3', houses: 0, mortgaged: false },
        },
      ],
    };

    expect(() => applyTrade({ ...command([owned('board-classic-space-01', 'player-3')]), proposal })).toThrow(TradePartyMismatchError);
  });

  it('refuses a proposal carried over from another game', () => {
    const base = command([owned('board-classic-space-01', 'player-1')]);
    const proposal = proposeTrade({
      ...base,
      proposerPlayerId: 'player-1',
      responderPlayerId: 'player-2',
      propertiesFromProposer: [{ boardSpaceId: 'board-classic-space-01' }],
    });

    expect(() => applyTrade({ ...base, proposal: { ...proposal, gameId: 'game-2' } })).toThrow(TradePartyMismatchError);
  });
});

describe('recording an auction result', () => {
  it('hands a free deed to the winner at whatever the table bid', () => {
    const result = recordAuctionResult({
      ...command([]),
      winnerPlayerId: 'player-2',
      boardSpaceId: 'board-classic-space-01',
      price: 340,
    });

    expect(result.transaction).toEqual({
      gameId: 'game-1',
      type: 'PROPERTY_AUCTION',
      amount: 340,
      totalAmount: 340,
      comment: null,
      participants: [{ playerId: 'player-2', balanceDelta: -340 }],
    });
    expect(result.propertyChanges).toEqual([
      { boardSpaceId: 'board-classic-space-01', ownerPlayerId: 'player-2', houses: 0, mortgaged: false },
    ]);
  });

  it.each([1, 999])('accepts a winning bid of %i, unbounded by the catalogue price of 60', (price) => {
    const result = recordAuctionResult({
      ...command([]),
      winnerPlayerId: 'player-1',
      boardSpaceId: 'board-classic-space-01',
      price,
    });

    expect(result.transaction).toMatchObject({ amount: price, totalAmount: price });
  });

  it('refuses to auction a deed that already has an owner', () => {
    expect(() =>
      recordAuctionResult({
        ...command([owned('board-classic-space-01', 'player-1')]),
        winnerPlayerId: 'player-2',
        boardSpaceId: 'board-classic-space-01',
        price: 100,
      }),
    ).toThrow(PropertyAlreadyOwnedError);
  });

  it('refuses a bid the winner cannot cover', () => {
    expect(() =>
      recordAuctionResult({
        ...command([], createPlayers([1500, 90])),
        winnerPlayerId: 'player-2',
        boardSpaceId: 'board-classic-space-01',
        price: 100,
      }),
    ).toThrow(InsufficientFundsError);
  });
});
