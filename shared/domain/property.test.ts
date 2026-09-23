import { describe, expect, it } from 'vitest';

import {
  BuildingBankEmptyError,
  BuildingsNotAllowedError,
  BuildingsPresentError,
  buildHouses,
  calculateRent,
  DiceTotalRequiredError,
  IncompleteColorGroupError,
  InvalidDiceTotalError,
  mortgageProperty,
  payRent,
  PropertyAlreadyOwnedError,
  PropertyMortgagedError,
  PropertyNotMortgagedError,
  PropertyNotOwnedError,
  purchaseProperty,
  sellBuildings,
  UnevenBuildingError,
  unmortgageProperty,
} from './property.js';
import { SameSourceAndDestinationError } from './banking.js';
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

/** A slice of the canonical catalogue: both browns, all three light blues, all four railroads, both utilities. */
const spaces: BoardSpace[] = [
  street('board-classic-space-01', 1, 'BROWN', 60, 30, 50, [2, 10, 30, 90, 160, 250]),
  street('board-classic-space-03', 3, 'BROWN', 60, 30, 50, [4, 20, 60, 180, 320, 450]),
  railroad('board-classic-space-05', 5),
  street('board-classic-space-06', 6, 'LIGHT_BLUE', 100, 50, 50, [6, 30, 90, 270, 400, 550]),
  street('board-classic-space-08', 8, 'LIGHT_BLUE', 100, 50, 50, [6, 30, 90, 270, 400, 550]),
  street('board-classic-space-09', 9, 'LIGHT_BLUE', 120, 60, 50, [8, 40, 100, 300, 450, 600]),
  utility('board-classic-space-12', 12),
  railroad('board-classic-space-15', 15),
  railroad('board-classic-space-25', 25),
  utility('board-classic-space-28', 28),
  railroad('board-classic-space-35', 35),
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

function command(properties: GameProperty[], buildingBank: BuildingBank = fullBank, players: Player[] = createPlayers()) {
  return { game, players, board, spaces, properties, buildingBank };
}

describe('property purchase', () => {
  it('charges the catalogue price and hands the deed to the buyer', () => {
    const result = purchaseProperty({ ...command([]), playerId: 'player-1', boardSpaceId: 'board-classic-space-01' });

    expect(result.transaction).toEqual({
      gameId: 'game-1',
      type: 'PROPERTY_PURCHASE',
      amount: 60,
      totalAmount: 60,
      comment: null,
      participants: [{ playerId: 'player-1', balanceDelta: -60 }],
    });
    expect(result.affectedPlayers.map((change) => change.balanceAfter)).toEqual([1440]);
    expect(result.propertyChanges).toEqual([
      { boardSpaceId: 'board-classic-space-01', ownerPlayerId: 'player-1', houses: 0, mortgaged: false },
    ]);
    expect(result.buildingBankDelta).toEqual({ houses: 0, hotels: 0 });
  });

  it('rejects buying a space that already has an owner', () => {
    const properties = [owned('board-classic-space-01', 'player-2')];

    expect(() =>
      purchaseProperty({ ...command(properties), playerId: 'player-1', boardSpaceId: 'board-classic-space-01' }),
    ).toThrow(PropertyAlreadyOwnedError);
  });
});

describe('street rent', () => {
  it('doubles the base rent when the owner holds the whole undeveloped colour group', () => {
    const properties = [owned('board-classic-space-01', 'player-1'), owned('board-classic-space-03', 'player-1')];

    expect(calculateRent({ ...command(properties), boardSpaceId: 'board-classic-space-01' })).toBe(4);
    expect(calculateRent({ ...command(properties), boardSpaceId: 'board-classic-space-03' })).toBe(8);
  });

  it('charges the plain base rent when the colour group is split', () => {
    const properties = [owned('board-classic-space-01', 'player-1'), owned('board-classic-space-03', 'player-2')];

    expect(calculateRent({ ...command(properties), boardSpaceId: 'board-classic-space-01' })).toBe(2);
  });

  it('still doubles when a space of the owner\'s group is mortgaged, but that space earns nothing', () => {
    const properties = [
      owned('board-classic-space-01', 'player-1'),
      owned('board-classic-space-03', 'player-1', { mortgaged: true }),
    ];

    expect(calculateRent({ ...command(properties), boardSpaceId: 'board-classic-space-01' })).toBe(4);
    expect(() => calculateRent({ ...command(properties), boardSpaceId: 'board-classic-space-03' })).toThrow(PropertyMortgagedError);
  });

  it('charges the level rent once a space is built on, and the hotel rate at level five', () => {
    const withHouses = [
      owned('board-classic-space-01', 'player-1', { houses: 3 }),
      owned('board-classic-space-03', 'player-1', { houses: 3 }),
    ];
    expect(calculateRent({ ...command(withHouses), boardSpaceId: 'board-classic-space-01' })).toBe(90);

    const withHotel = [
      owned('board-classic-space-01', 'player-1', { houses: 5 }),
      owned('board-classic-space-03', 'player-1', { houses: 4 }),
    ];
    expect(calculateRent({ ...command(withHotel), boardSpaceId: 'board-classic-space-01' })).toBe(250);
  });

  it('drops the undeveloped double as soon as any space of the group carries a building', () => {
    const properties = [
      owned('board-classic-space-01', 'player-1'),
      owned('board-classic-space-03', 'player-1', { houses: 1 }),
    ];

    expect(calculateRent({ ...command(properties), boardSpaceId: 'board-classic-space-01' })).toBe(2);
  });
});

describe('railroad and utility rent', () => {
  const railroadIds = ['board-classic-space-05', 'board-classic-space-15', 'board-classic-space-25', 'board-classic-space-35'];

  it('scales with the number of railroads the owner holds', () => {
    for (const [index, expected] of [25, 50, 100, 200].entries()) {
      const properties = railroadIds.slice(0, index + 1).map((id) => owned(id, 'player-1'));
      expect(calculateRent({ ...command(properties), boardSpaceId: 'board-classic-space-05' })).toBe(expected);
    }
  });

  it('ignores the owner\'s mortgaged railroads when counting', () => {
    const properties = [
      owned('board-classic-space-05', 'player-1'),
      owned('board-classic-space-15', 'player-1'),
      owned('board-classic-space-25', 'player-1', { mortgaged: true }),
      owned('board-classic-space-35', 'player-2'),
    ];

    expect(calculateRent({ ...command(properties), boardSpaceId: 'board-classic-space-05' })).toBe(50);
  });

  it('multiplies the dice total by four for one utility and by ten for both', () => {
    const single = [owned('board-classic-space-12', 'player-1')];
    expect(calculateRent({ ...command(single), boardSpaceId: 'board-classic-space-12', diceTotal: 7 })).toBe(28);

    const pair = [...single, owned('board-classic-space-28', 'player-1')];
    expect(calculateRent({ ...command(pair), boardSpaceId: 'board-classic-space-12', diceTotal: 7 })).toBe(70);
  });

  it('counts a mortgaged utility toward the pair rate, unlike a mortgaged railroad', () => {
    // Deliberate asymmetry: railroadRent excludes mortgaged railroads from its count, but
    // utilityRent counts every deed the owner holds regardless of mortgage state -- a
    // mortgaged deed is still owned. Pin both utilities held, one mortgaged, at the pair rate.
    const properties = [
      owned('board-classic-space-12', 'player-1'),
      owned('board-classic-space-28', 'player-1', { mortgaged: true }),
    ];

    expect(calculateRent({ ...command(properties), boardSpaceId: 'board-classic-space-12', diceTotal: 7 })).toBe(70);
  });

  it('refuses to price a utility without a valid dice total', () => {
    const properties = [owned('board-classic-space-12', 'player-1')];

    expect(() => calculateRent({ ...command(properties), boardSpaceId: 'board-classic-space-12' })).toThrow(DiceTotalRequiredError);
    expect(() => calculateRent({ ...command(properties), boardSpaceId: 'board-classic-space-12', diceTotal: 13 })).toThrow(InvalidDiceTotalError);
    expect(() => calculateRent({ ...command(properties), boardSpaceId: 'board-classic-space-12', diceTotal: 1 })).toThrow(InvalidDiceTotalError);
  });
});

describe('paying rent', () => {
  it('moves the rent from the payer to the owner', () => {
    const properties = [owned('board-classic-space-01', 'player-1'), owned('board-classic-space-03', 'player-1')];

    const result = payRent({ ...command(properties), payerPlayerId: 'player-2', boardSpaceId: 'board-classic-space-01' });

    expect(result.transaction).toEqual({
      gameId: 'game-1',
      type: 'PROPERTY_RENT',
      amount: 4,
      totalAmount: 4,
      comment: null,
      participants: [
        { playerId: 'player-2', balanceDelta: -4 },
        { playerId: 'player-1', balanceDelta: 4 },
      ],
    });
    expect(result.propertyChanges).toEqual([]);
  });

  it('collects nothing on a mortgaged space', () => {
    const properties = [owned('board-classic-space-01', 'player-1', { mortgaged: true })];

    expect(() =>
      payRent({ ...command(properties), payerPlayerId: 'player-2', boardSpaceId: 'board-classic-space-01' }),
    ).toThrow(PropertyMortgagedError);
  });

  it('refuses to charge the owner rent on their own space', () => {
    const properties = [owned('board-classic-space-01', 'player-1')];

    expect(() =>
      payRent({ ...command(properties), payerPlayerId: 'player-1', boardSpaceId: 'board-classic-space-01' }),
    ).toThrow(SameSourceAndDestinationError);
  });
});

describe('building', () => {
  const brownGroup = (): GameProperty[] => [owned('board-classic-space-01', 'player-1'), owned('board-classic-space-03', 'player-1')];

  it('charges the house cost and takes the house out of the bank', () => {
    const result = buildHouses({ ...command(brownGroup()), playerId: 'player-1', boardSpaceId: 'board-classic-space-01', count: 1 });

    expect(result.transaction).toMatchObject({ type: 'PROPERTY_BUILD', amount: 50, totalAmount: 50 });
    expect(result.propertyChanges).toEqual([
      { boardSpaceId: 'board-classic-space-01', ownerPlayerId: 'player-1', houses: 1, mortgaged: false },
    ]);
    expect(result.buildingBankDelta).toEqual({ houses: -1, hotels: 0 });
  });

  it('refuses to build without the whole colour group', () => {
    const properties = [owned('board-classic-space-01', 'player-1'), owned('board-classic-space-03', 'player-2')];

    expect(() =>
      buildHouses({ ...command(properties), playerId: 'player-1', boardSpaceId: 'board-classic-space-01', count: 1 }),
    ).toThrow(IncompleteColorGroupError);
  });

  it('refuses a build that would leave the group more than one house apart', () => {
    expect(() =>
      buildHouses({ ...command(brownGroup()), playerId: 'player-1', boardSpaceId: 'board-classic-space-01', count: 2 }),
    ).toThrow(UnevenBuildingError);
  });

  it('refuses to build out of an empty building bank', () => {
    expect(() =>
      buildHouses({
        ...command(brownGroup(), { housesAvailable: 0, hotelsAvailable: 12 }),
        playerId: 'player-1',
        boardSpaceId: 'board-classic-space-01',
        count: 1,
      }),
    ).toThrow(BuildingBankEmptyError);
  });

  it('returns four houses and takes one hotel when a space reaches level five', () => {
    const properties = [
      owned('board-classic-space-01', 'player-1', { houses: 4 }),
      owned('board-classic-space-03', 'player-1', { houses: 4 }),
    ];

    const result = buildHouses({ ...command(properties), playerId: 'player-1', boardSpaceId: 'board-classic-space-01', count: 1 });

    expect(result.propertyChanges[0].houses).toBe(5);
    expect(result.buildingBankDelta).toEqual({ houses: 4, hotels: -1 });
  });

  it('refuses the hotel when the bank holds no hotels', () => {
    const properties = [
      owned('board-classic-space-01', 'player-1', { houses: 4 }),
      owned('board-classic-space-03', 'player-1', { houses: 4 }),
    ];

    expect(() =>
      buildHouses({
        ...command(properties, { housesAvailable: 32, hotelsAvailable: 0 }),
        playerId: 'player-1',
        boardSpaceId: 'board-classic-space-01',
        count: 1,
      }),
    ).toThrow(BuildingBankEmptyError);
  });

  it('refuses to build on a railroad or utility, which carry no house cost', () => {
    const railroadProperties = [owned('board-classic-space-05', 'player-1')];
    expect(() =>
      buildHouses({ ...command(railroadProperties), playerId: 'player-1', boardSpaceId: 'board-classic-space-05', count: 1 }),
    ).toThrow(BuildingsNotAllowedError);

    const utilityProperties = [owned('board-classic-space-12', 'player-1')];
    expect(() =>
      buildHouses({ ...command(utilityProperties), playerId: 'player-1', boardSpaceId: 'board-classic-space-12', count: 1 }),
    ).toThrow(BuildingsNotAllowedError);
  });

  it('refuses a build that would push a space past a hotel (level five)', () => {
    const properties = [
      owned('board-classic-space-01', 'player-1', { houses: 5 }),
      owned('board-classic-space-03', 'player-1', { houses: 4 }),
    ];

    expect(() =>
      buildHouses({ ...command(properties), playerId: 'player-1', boardSpaceId: 'board-classic-space-01', count: 1 }),
    ).toThrow(BuildingsNotAllowedError);
  });
});

describe('selling buildings', () => {
  it('pays back half the house cost and returns the houses to the bank', () => {
    const properties = [
      owned('board-classic-space-01', 'player-1', { houses: 2 }),
      owned('board-classic-space-03', 'player-1', { houses: 2 }),
    ];

    const result = sellBuildings({ ...command(properties), playerId: 'player-1', boardSpaceId: 'board-classic-space-01', count: 1 });

    expect(result.transaction).toMatchObject({ type: 'PROPERTY_SELL_BUILDINGS', amount: 25, totalAmount: 25 });
    expect(result.affectedPlayers.map((change) => change.balanceAfter)).toEqual([1525]);
    expect(result.propertyChanges).toEqual([
      { boardSpaceId: 'board-classic-space-01', ownerPlayerId: 'player-1', houses: 1, mortgaged: false },
    ]);
    expect(result.buildingBankDelta).toEqual({ houses: 1, hotels: 0 });
  });

  it('trades the hotel back for four houses out of the bank', () => {
    const properties = [
      owned('board-classic-space-01', 'player-1', { houses: 5 }),
      owned('board-classic-space-03', 'player-1', { houses: 4 }),
    ];

    const result = sellBuildings({ ...command(properties), playerId: 'player-1', boardSpaceId: 'board-classic-space-01', count: 1 });

    expect(result.buildingBankDelta).toEqual({ houses: -4, hotels: 1 });
  });

  it('refuses to break a hotel the bank cannot cover with four houses', () => {
    const properties = [
      owned('board-classic-space-01', 'player-1', { houses: 5 }),
      owned('board-classic-space-03', 'player-1', { houses: 4 }),
    ];

    expect(() =>
      sellBuildings({
        ...command(properties, { housesAvailable: 3, hotelsAvailable: 12 }),
        playerId: 'player-1',
        boardSpaceId: 'board-classic-space-01',
        count: 1,
      }),
    ).toThrow(BuildingBankEmptyError);
  });

  it('floors the half-price payout on an odd house cost, pinning the rounding direction', () => {
    // Every canonical house_cost is even, so Math.floor(houseCost / 2) is indistinguishable
    // from a round-half-down on the shipped boards. A custom board can carry an odd cost, so
    // pin the direction here: floor(75 / 2) = 37, not 38.
    const oddSpaces: BoardSpace[] = [
      street('odd-cost-space-01', 1, 'BROWN', 60, 30, 75, [2, 10, 30, 90, 160, 250]),
      street('odd-cost-space-03', 3, 'BROWN', 60, 30, 75, [4, 20, 60, 180, 320, 450]),
    ];
    const properties = [
      owned('odd-cost-space-01', 'player-1', { houses: 2 }),
      owned('odd-cost-space-03', 'player-1', { houses: 2 }),
    ];

    const result = sellBuildings({
      ...command(properties),
      spaces: oddSpaces,
      playerId: 'player-1',
      boardSpaceId: 'odd-cost-space-01',
      count: 1,
    });

    expect(result.transaction).toMatchObject({ type: 'PROPERTY_SELL_BUILDINGS', amount: 37, totalAmount: 37 });
  });
});

describe('property not owned', () => {
  it('refuses to price rent on a space nobody owns', () => {
    expect(() => calculateRent({ ...command([]), boardSpaceId: 'board-classic-space-01' })).toThrow(PropertyNotOwnedError);
  });

  it('refuses to sell buildings on a space the player does not own', () => {
    expect(() =>
      sellBuildings({ ...command([]), playerId: 'player-1', boardSpaceId: 'board-classic-space-01', count: 1 }),
    ).toThrow(PropertyNotOwnedError);
  });
});

describe('mortgaging', () => {
  it('pays the mortgage value and marks the deed mortgaged', () => {
    const properties = [owned('board-classic-space-01', 'player-1'), owned('board-classic-space-03', 'player-1')];

    const result = mortgageProperty({ ...command(properties), playerId: 'player-1', boardSpaceId: 'board-classic-space-01' });

    expect(result.transaction).toMatchObject({ type: 'PROPERTY_MORTGAGE', amount: 30, totalAmount: 30 });
    expect(result.affectedPlayers.map((change) => change.balanceAfter)).toEqual([1530]);
    expect(result.propertyChanges).toEqual([
      { boardSpaceId: 'board-classic-space-01', ownerPlayerId: 'player-1', houses: 0, mortgaged: true },
    ]);
  });

  it('refuses while any space of the colour group still carries a building', () => {
    const properties = [
      owned('board-classic-space-01', 'player-1'),
      owned('board-classic-space-03', 'player-1', { houses: 1 }),
    ];

    expect(() =>
      mortgageProperty({ ...command(properties), playerId: 'player-1', boardSpaceId: 'board-classic-space-01' }),
    ).toThrow(BuildingsPresentError);
  });

  it('refuses to unmortgage a deed that is not mortgaged', () => {
    const properties = [owned('board-classic-space-01', 'player-1')];

    expect(() =>
      unmortgageProperty({ ...command(properties), playerId: 'player-1', boardSpaceId: 'board-classic-space-01' }),
    ).toThrow(PropertyNotMortgagedError);
  });

  it('charges the mortgage value plus interest rounded up when unmortgaging', () => {
    // 75 + ceil(75 * 10 / 100) = 75 + ceil(7.5) = 83, not 82.
    const properties = [owned('board-classic-space-12', 'player-1', { mortgaged: true })];

    const result = unmortgageProperty({ ...command(properties), playerId: 'player-1', boardSpaceId: 'board-classic-space-12' });

    expect(result.transaction).toMatchObject({ type: 'PROPERTY_UNMORTGAGE', amount: 83, totalAmount: 83 });
    expect(result.affectedPlayers.map((change) => change.balanceAfter)).toEqual([1417]);
    expect(result.propertyChanges).toEqual([
      { boardSpaceId: 'board-classic-space-12', ownerPlayerId: 'player-1', houses: 0, mortgaged: false },
    ]);
  });
});
