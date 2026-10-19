import { describe, expect, it } from 'vitest';
import type { BoardSnapshot } from '../board/types.js';
import type { GameProperty } from '../types/monopoly.js';
import { buildGameSettings } from './game-rules.js';
import {
  applyChanges,
  assertCanBuild,
  assertCanMortgage,
  assertCanSellBuilding,
  BuildMortgagedGroupError,
  BuildRequiresFullGroupError,
  BuildUnevenError,
  buildCost,
  buildingChange,
  canBuild,
  canMortgage,
  canSellBuilding,
  DiceSumError,
  groupHasBuildings,
  groupTiles,
  holdsFullGroup,
  InvalidBuildTargetError,
  invertChanges,
  MaxBuildingsError,
  mortgageChange,
  NoBuildingsError,
  offendingStreets,
  orderTilesForPicker,
  ownerChange,
  planBuildings,
  PropertyAlreadyOwnedError,
  PropertyHasBuildingsError,
  PropertyMortgagedError,
  PropertyNotOwnedError,
  purchasePrice,
  rentFor,
  requireTile,
  sellRefund,
  TileNotBuildableError,
  TileNotFoundError,
  type PropertyContext,
} from './property.js';

const board = buildGameSettings(15_000_000, 'monopoly-ru-2012').board as BoardSnapshot;

type Overrides = Record<string, Partial<Omit<GameProperty, 'gameId' | 'tileId'>>>;

function registry(overrides: Overrides = {}): GameProperty[] {
  return board.tiles.map((tile) => ({
    gameId: 'game-1',
    tileId: tile.id,
    ownerPlayerId: null,
    mortgaged: false,
    houses: 0,
    ...overrides[tile.id],
  }));
}

const owned = (ownerPlayerId = 'a') => ({ ownerPlayerId });

describe('tile lookup and price', () => {
  it('finds a tile and reads the snapshot price', () => {
    expect(requireTile(board, 'zhitna').name).toBe('Житна вул.');
    expect(purchasePrice(board, 'zhitna')).toBe(600_000);
  });

  it('throws for a tile that is not on the board', () => {
    expect(() => requireTile(board, 'nowhere')).toThrow(TileNotFoundError);
  });

  it('prices from the game snapshot, not the preset', () => {
    const small = buildGameSettings(1_500_000, 'monopoly-ru-2012').board as BoardSnapshot;
    expect(purchasePrice(small, 'zhitna')).toBe(60_000);
  });
});

describe('canMortgage', () => {
  it('allows the owner of an unmortgaged tile with no buildings', () => {
    expect(canMortgage(board, registry({ zhitna: owned() }), 'zhitna', 'a')).toBe(true);
  });

  it('refuses a tile owned by someone else, unowned or already mortgaged', () => {
    expect(canMortgage(board, registry({ zhitna: owned('b') }), 'zhitna', 'a')).toBe(false);
    expect(canMortgage(board, registry(), 'zhitna', 'a')).toBe(false);
    expect(
      canMortgage(board, registry({ zhitna: { ...owned(), mortgaged: true } }), 'zhitna', 'a'),
    ).toBe(false);
  });

  it('refuses a tile with houses or whose colour group has buildings', () => {
    expect(canMortgage(board, registry({ zhitna: { ...owned(), houses: 1 } }), 'zhitna', 'a')).toBe(
      false,
    );
    expect(
      canMortgage(
        board,
        registry({ zhitna: owned(), nagatinska: { ...owned(), houses: 2 } }),
        'zhitna',
        'a',
      ),
    ).toBe(false);
  });

  it('refuses an unknown tile', () => {
    expect(canMortgage(board, registry(), 'nowhere', 'a')).toBe(false);
  });
});

describe('rentFor a street', () => {
  it('charges the base rent when the owner holds only part of the group', () => {
    expect(rentFor(board, registry({ zhitna: owned() }), 'zhitna')).toBe(20_000);
  });

  it('doubles the base rent when the owner holds the whole unimproved group', () => {
    const full = registry({ zhitna: owned(), nagatinska: owned() });
    expect(rentFor(board, full, 'zhitna')).toBe(40_000);
    expect(rentFor(board, full, 'nagatinska')).toBe(80_000);
  });

  it('does not double the rent of a group split between two owners', () => {
    expect(rentFor(board, registry({ zhitna: owned(), nagatinska: owned('b') }), 'zhitna')).toBe(
      20_000,
    );
  });

  it('does not double a tile with no houses when another tile of the group has some', () => {
    const state = registry({ zhitna: owned(), nagatinska: { ...owned(), houses: 1 } });
    expect(rentFor(board, state, 'zhitna')).toBe(20_000);
    expect(rentFor(board, state, 'nagatinska')).toBe(200_000);
  });

  it('charges the rent row for one to four houses and the hotel', () => {
    const rents = [100_000, 300_000, 900_000, 1_600_000, 2_500_000];
    rents.forEach((rent, index) => {
      const state = registry({
        zhitna: { ...owned(), houses: index + 1 },
        nagatinska: owned(),
      });
      expect(rentFor(board, state, 'zhitna')).toBe(rent);
    });
  });

  it('rejects a dice sum on a street', () => {
    expect(() => rentFor(board, registry({ zhitna: owned() }), 'zhitna', 7)).toThrow(DiceSumError);
  });
});

describe('rentFor a railway', () => {
  const rails = ['riga_rail', 'kursk_rail', 'kazan_rail', 'leningrad_rail'];

  it('charges by the number of railways the owner holds', () => {
    const expected = [250_000, 500_000, 1_000_000, 2_000_000];
    expected.forEach((rent, index) => {
      const overrides: Overrides = {};
      for (const id of rails.slice(0, index + 1)) overrides[id] = owned();
      expect(rentFor(board, registry(overrides), 'riga_rail')).toBe(rent);
    });
  });

  it('does not count railways of another owner', () => {
    expect(
      rentFor(board, registry({ riga_rail: owned(), kursk_rail: owned('b') }), 'riga_rail'),
    ).toBe(250_000);
  });

  it('counts a mortgaged railway the owner still holds', () => {
    expect(
      rentFor(
        board,
        registry({ riga_rail: owned(), kursk_rail: { ...owned(), mortgaged: true } }),
        'riga_rail',
      ),
    ).toBe(500_000);
  });
});

describe('rentFor a utility', () => {
  it('charges 4 times the dice sum for one utility and 10 times for both, in thousands', () => {
    expect(rentFor(board, registry({ power_plant: owned() }), 'power_plant', 7)).toBe(28_000);
    expect(
      rentFor(board, registry({ power_plant: owned(), waterworks: owned() }), 'power_plant', 7),
    ).toBe(70_000);
  });

  it('pays 16 000 for a 4 and one utility, and 40 000 for a 4 and both', () => {
    expect(rentFor(board, registry({ power_plant: owned() }), 'power_plant', 4)).toBe(16_000);
    expect(
      rentFor(board, registry({ power_plant: owned(), waterworks: owned() }), 'waterworks', 4),
    ).toBe(40_000);
  });

  it('needs the dice sum', () => {
    expect(() => rentFor(board, registry({ power_plant: owned() }), 'power_plant')).toThrow(
      DiceSumError,
    );
  });
});

describe('rentFor refusals', () => {
  it('refuses an unowned tile', () => {
    expect(() => rentFor(board, registry(), 'zhitna')).toThrow(PropertyNotOwnedError);
  });

  it('refuses a mortgaged tile, which earns nothing', () => {
    expect(() =>
      rentFor(board, registry({ zhitna: { ...owned(), mortgaged: true } }), 'zhitna'),
    ).toThrow(PropertyMortgagedError);
  });

  it('refuses a tile that is not on the board', () => {
    expect(() => rentFor(board, registry(), 'nowhere')).toThrow(TileNotFoundError);
  });
});

describe('registry changes', () => {
  const unowned = { ownerPlayerId: null, mortgaged: false, houses: 0 };

  it('hands a tile to a player and back to the bank unmortgaged', () => {
    const bought = ownerChange('zhitna', unowned, 'a');
    expect(bought.after).toEqual({ ownerPlayerId: 'a', mortgaged: false, houses: 0 });
    const released = ownerChange(
      'zhitna',
      { ownerPlayerId: 'a', mortgaged: true, houses: 0 },
      null,
    );
    expect(released.after).toEqual(unowned);
  });

  it('keeps the mortgage flag when a tile changes hands between players', () => {
    const moved = ownerChange('zhitna', { ownerPlayerId: 'a', mortgaged: true, houses: 0 }, 'b');
    expect(moved.after).toEqual({ ownerPlayerId: 'b', mortgaged: true, houses: 0 });
  });

  it('inverts a change and applies it to a registry', () => {
    const change = mortgageChange(
      'zhitna',
      { ownerPlayerId: 'a', mortgaged: false, houses: 0 },
      true,
    );
    const after = applyChanges(registry({ zhitna: owned() }), [change]);
    expect(after.find((row) => row.tileId === 'zhitna')?.mortgaged).toBe(true);
    const back = applyChanges(after, invertChanges([change]));
    expect(back.find((row) => row.tileId === 'zhitna')?.mortgaged).toBe(false);
  });
});

describe('orderTilesForPicker', () => {
  const tile = (id: string) => {
    const found = board.tiles.find((candidate) => candidate.id === id);
    if (found === undefined) throw new Error(id);
    return found;
  };
  const streets = board.tiles.filter((candidate) => candidate.type === 'street');

  it('lists free tiles first, owned last, grouped by colour and ascending by price', () => {
    const pool = [...streets].reverse().map((candidate, index) => ({
      tile: candidate,
      ownerPlayerId: index % 3 === 0 ? 'p1' : null,
    }));
    const sections = orderTilesForPicker(pool);
    expect(sections.map((entry) => entry.kind)).toEqual(['free', 'owned']);
    for (const entry of sections) {
      const groups = entry.groups.map((group) => group.group);
      expect(new Set(groups).size).toBe(groups.length);
      for (const group of entry.groups) {
        const prices = group.items.map((item) => item.tile.price);
        expect(prices).toEqual([...prices].sort((a, b) => a - b));
        expect(group.items.every((item) => item.tile.group === group.group)).toBe(true);
      }
      const cheapest = entry.groups.map((group) => group.items[0]!.tile.price);
      expect(cheapest).toEqual([...cheapest].sort((a, b) => a - b));
    }
  });

  it('omits empty sections and does not modify the input', () => {
    const only = [{ tile: tile(streets[0]!.id), ownerPlayerId: 'p1' }];
    const copy = [...only];
    expect(orderTilesForPicker(only).map((entry) => entry.kind)).toEqual(['owned']);
    expect(only).toEqual(copy);
    expect(orderTilesForPicker([])).toEqual([]);
  });
});

describe('offendingStreets', () => {
  const brown = board.tiles.filter((candidate) => candidate.group === 'brown');
  const owned = registry(
    Object.fromEntries(brown.map((tile) => [tile.id, { ownerPlayerId: 'p1' }])),
  );
  const [first, second] = brown;
  it('marks the street that runs ahead of an uneven build', () => {
    const context = { board, registry: owned };
    expect(
      offendingStreets(context, first!.id, 'BUILD_UNEVEN', { [first!.id]: 3 }, 'BUILD'),
    ).toEqual([first!.id]);
    expect(
      offendingStreets(context, first!.id, 'BUILD_UNEVEN', { [first!.id]: 1 }, 'BUILD'),
    ).toEqual([]);
  });
  it('marks the mortgaged streets and nothing for other codes', () => {
    const mortgaged = registry(
      Object.fromEntries(
        brown.map((tile) => [tile.id, { ownerPlayerId: 'p1', mortgaged: tile.id === second!.id }]),
      ),
    );
    expect(
      offendingStreets(
        { board, registry: mortgaged },
        first!.id,
        'BUILD_MORTGAGED_GROUP',
        {},
        'BUILD',
      ),
    ).toEqual([second!.id]);
    expect(offendingStreets({ board, registry: owned }, first!.id, 'OTHER', {}, 'SELL')).toEqual(
      [],
    );
  });
});

const without = (extra: Partial<BoardSnapshot['rules']>): BoardSnapshot => ({
  ...board,
  rules: { ...board.rules, ...extra },
});
const attempt = (run: () => unknown): unknown => {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
};
const context = (overrides: Overrides, snapshot: BoardSnapshot = board): PropertyContext => ({
  board: snapshot,
  registry: registry(overrides),
});
const fullBrown = (zhitna: number, nagatinska: number): Overrides => ({
  zhitna: { ownerPlayerId: 'a', houses: zhitna },
  nagatinska: { ownerPlayerId: 'a', houses: nagatinska },
});

describe('property errors carry their code, status, message and details', () => {
  it.each([
    [
      new TileNotFoundError('t'),
      'TILE_NOT_FOUND',
      404,
      'This tile is not on the board.',
      { tileId: 't' },
    ],
    [
      new PropertyAlreadyOwnedError('t', 'p'),
      'PROPERTY_ALREADY_OWNED',
      409,
      'This property already has an owner.',
      { tileId: 't', ownerPlayerId: 'p' },
    ],
    [
      new PropertyNotOwnedError('t'),
      'PROPERTY_NOT_OWNED',
      409,
      'The player does not own this property.',
      { tileId: 't' },
    ],
    [
      new PropertyMortgagedError('t'),
      'PROPERTY_MORTGAGED',
      409,
      'This property is mortgaged.',
      { tileId: 't' },
    ],
    [
      new PropertyHasBuildingsError('t'),
      'PROPERTY_HAS_BUILDINGS',
      409,
      'This property or its colour group has buildings.',
      { tileId: 't' },
    ],
    [
      new TileNotBuildableError('t'),
      'TILE_NOT_BUILDABLE',
      409,
      'Only streets can have houses or hotels.',
      { tileId: 't' },
    ],
    [
      new BuildRequiresFullGroupError('t'),
      'BUILD_REQUIRES_FULL_GROUP',
      409,
      'The player must hold the whole colour group to build.',
      { tileId: 't' },
    ],
    [
      new BuildUnevenError('t'),
      'BUILD_UNEVEN',
      409,
      'Buildings must be spread evenly across the colour group.',
      { tileId: 't' },
    ],
    [
      new BuildMortgagedGroupError('t'),
      'BUILD_MORTGAGED_GROUP',
      409,
      'A tile of this colour group is mortgaged.',
      { tileId: 't' },
    ],
    [
      new NoBuildingsError('t'),
      'NO_BUILDINGS',
      409,
      'This property has no buildings to sell.',
      { tileId: 't' },
    ],
    [
      new MaxBuildingsError('t'),
      'MAX_BUILDINGS',
      409,
      'This property already has a hotel.',
      { tileId: 't' },
    ],
    [
      new InvalidBuildTargetError('why', 't'),
      'INVALID_BUILD_TARGET',
      400,
      'Invalid building request: why.',
      { reason: 'why', tileId: 't' },
    ],
    [
      new InvalidBuildTargetError('why'),
      'INVALID_BUILD_TARGET',
      400,
      'Invalid building request: why.',
      { reason: 'why' },
    ],
    [
      new DiceSumError(true),
      'VALIDATION_ERROR',
      400,
      'diceSum is required to pay the rent of a utility.',
      { field: 'diceSum' },
    ],
    [
      new DiceSumError(false),
      'VALIDATION_ERROR',
      400,
      'diceSum applies to utilities only.',
      { field: 'diceSum' },
    ],
  ])('%s', (error, code, status, message, details) => {
    expect(error).toMatchObject({ code, status, message, details });
    expect(Object.keys(error.details ?? {})).toEqual(Object.keys(details));
  });
});

describe('who may build and sell on a colour group', () => {
  it('lets the owner of the whole unmortgaged group build, evenly', () => {
    expect(canBuild(board, registry(fullBrown(0, 0)), 'zhitna', 'a')).toBe(true);
    expect(canBuild(board, registry(fullBrown(1, 1)), 'nagatinska', 'a')).toBe(true);
    expect(canBuild(board, registry(fullBrown(4, 4)), 'zhitna', 'a')).toBe(true);
  });

  it('refuses an unknown tile without throwing', () => {
    expect(canBuild(board, registry(), 'nowhere', 'a')).toBe(false);
    expect(canSellBuilding(board, registry(), 'nowhere', 'a')).toBe(false);
    expect(canMortgage(board, registry(), 'nowhere', 'a')).toBe(false);
  });

  it.each(['riga_rail', 'power_plant'])('does not allow building or selling on %s', (tileId) => {
    const state = registry({ [tileId]: { ownerPlayerId: 'a' } });
    expect(canBuild(board, state, tileId, 'a')).toBe(false);
    expect(canSellBuilding(board, state, tileId, 'a')).toBe(false);
    expect(attempt(() => assertCanBuild({ board, registry: state }, tileId, 'a'))).toMatchObject({
      code: 'TILE_NOT_BUILDABLE',
      details: { tileId },
    });
    expect(
      attempt(() => assertCanSellBuilding({ board, registry: state }, tileId, 'a')),
    ).toMatchObject({ code: 'TILE_NOT_BUILDABLE', details: { tileId } });
  });

  it('names the first reason a build is refused', () => {
    const reason = (overrides: Overrides, tileId = 'zhitna', playerId = 'a') =>
      attempt(() => assertCanBuild(context(overrides), tileId, playerId));
    expect(reason({}, 'nowhere')).toMatchObject({ code: 'TILE_NOT_FOUND' });
    expect(reason({ zhitna: { ownerPlayerId: 'b' } })).toMatchObject({
      code: 'PROPERTY_NOT_OWNED',
      details: { tileId: 'zhitna' },
    });
    expect(reason({ zhitna: { ownerPlayerId: 'a' } })).toMatchObject({
      code: 'BUILD_REQUIRES_FULL_GROUP',
      details: { tileId: 'zhitna' },
    });
    expect(
      reason({
        zhitna: { ownerPlayerId: 'a' },
        nagatinska: { ownerPlayerId: 'a', mortgaged: true },
      }),
    ).toMatchObject({ code: 'BUILD_MORTGAGED_GROUP', details: { tileId: 'zhitna' } });
    expect(
      reason({
        zhitna: { ownerPlayerId: 'a', mortgaged: true },
        nagatinska: { ownerPlayerId: 'a' },
      }),
    ).toMatchObject({ code: 'BUILD_MORTGAGED_GROUP' });
    expect(reason(fullBrown(5, 5))).toMatchObject({
      code: 'MAX_BUILDINGS',
      details: { tileId: 'zhitna' },
    });
    expect(reason(fullBrown(2, 1))).toMatchObject({
      code: 'BUILD_UNEVEN',
      details: { tileId: 'zhitna' },
    });
    expect(reason(fullBrown(1, 1))).toBeUndefined();
    expect(reason(fullBrown(1, 2))).toBeUndefined();
  });

  it('lets a build run ahead when even building is switched off', () => {
    const loose = without({ buildEvenly: false });
    expect(canBuild(loose, registry(fullBrown(3, 0)), 'zhitna', 'a')).toBe(true);
    expect(canBuild(board, registry(fullBrown(3, 0)), 'zhitna', 'a')).toBe(false);
  });

  it('names the first reason a sale is refused', () => {
    const reason = (overrides: Overrides, tileId = 'zhitna', playerId = 'a') =>
      attempt(() => assertCanSellBuilding(context(overrides), tileId, playerId));
    expect(reason({}, 'nowhere')).toMatchObject({ code: 'TILE_NOT_FOUND' });
    expect(reason(fullBrown(1, 1), 'zhitna', 'b')).toMatchObject({
      code: 'PROPERTY_NOT_OWNED',
      details: { tileId: 'zhitna' },
    });
    expect(reason(fullBrown(0, 1))).toMatchObject({
      code: 'NO_BUILDINGS',
      details: { tileId: 'zhitna' },
    });
    expect(reason(fullBrown(1, 2))).toMatchObject({
      code: 'BUILD_UNEVEN',
      details: { tileId: 'zhitna' },
    });
    expect(reason(fullBrown(2, 2))).toBeUndefined();
    expect(reason(fullBrown(2, 1))).toBeUndefined();
  });

  it('lets a sale leave the group uneven when even building is switched off', () => {
    const state = registry(fullBrown(1, 3));
    expect(canSellBuilding(board, state, 'zhitna', 'a')).toBe(false);
    expect(canSellBuilding(without({ buildEvenly: false }), state, 'zhitna', 'a')).toBe(true);
  });

  it('lets an owner sell without holding the whole group', () => {
    expect(
      canSellBuilding(
        board,
        registry({ zhitna: { ownerPlayerId: 'a', houses: 1 } }),
        'zhitna',
        'a',
      ),
    ).toBe(true);
  });
});

describe('mortgage refusals name their reason', () => {
  const reason = (overrides: Overrides, tileId = 'zhitna', playerId = 'a') =>
    attempt(() => assertCanMortgage(context(overrides), tileId, playerId));

  it('refuses in order: not the owner, already mortgaged, buildings on the tile or its group', () => {
    expect(reason({ zhitna: { ownerPlayerId: 'b' } })).toMatchObject({
      code: 'PROPERTY_NOT_OWNED',
      details: { tileId: 'zhitna' },
    });
    expect(reason({ zhitna: { ownerPlayerId: 'a', mortgaged: true } })).toMatchObject({
      code: 'PROPERTY_MORTGAGED',
    });
    expect(reason({ zhitna: { ownerPlayerId: 'a', houses: 1 } })).toMatchObject({
      code: 'PROPERTY_HAS_BUILDINGS',
    });
    expect(reason(fullBrown(0, 1))).toMatchObject({ code: 'PROPERTY_HAS_BUILDINGS' });
    expect(reason(fullBrown(0, 0))).toBeUndefined();
    expect(reason({ zhitna: { ownerPlayerId: 'a' } }, 'nowhere')).toMatchObject({
      code: 'TILE_NOT_FOUND',
    });
  });

  it('knows whether a group is held in full and whether it has buildings', () => {
    const tile = requireTile(board, 'zhitna');
    expect(holdsFullGroup(board, registry(fullBrown(0, 0)), tile, 'a')).toBe(true);
    expect(holdsFullGroup(board, registry({ zhitna: { ownerPlayerId: 'a' } }), tile, 'a')).toBe(
      false,
    );
    expect(groupHasBuildings(board, registry(fullBrown(0, 0)), tile)).toBe(false);
    expect(groupHasBuildings(board, registry(fullBrown(0, 1)), tile)).toBe(true);
    expect(groupTiles(board, tile).map((item) => item.id)).toEqual(['zhitna', 'nagatinska']);
  });
});

describe('planBuildings', () => {
  const plan = (
    overrides: Overrides,
    targets: Record<string, number>,
    direction: 'BUILD' | 'SELL' = 'BUILD',
    snapshot: BoardSnapshot = board,
  ) => planBuildings(context(overrides, snapshot), 'a', targets, direction);
  const refused = (
    overrides: Overrides,
    targets: Record<string, number>,
    direction: 'BUILD' | 'SELL' = 'BUILD',
    snapshot: BoardSnapshot = board,
  ) => attempt(() => plan(overrides, targets, direction, snapshot));

  it('plans one change per street whose level changes and counts the buildings', () => {
    const result = plan(fullBrown(0, 0), { zhitna: 3, nagatinska: 2 });
    expect(result.buildings).toBe(5);
    expect(result.changes).toEqual([
      {
        tileId: 'zhitna',
        before: { ownerPlayerId: 'a', mortgaged: false, houses: 0 },
        after: { ownerPlayerId: 'a', mortgaged: false, houses: 3 },
      },
      {
        tileId: 'nagatinska',
        before: { ownerPlayerId: 'a', mortgaged: false, houses: 0 },
        after: { ownerPlayerId: 'a', mortgaged: false, houses: 2 },
      },
    ]);
  });

  it('keeps a street left out of the plan at its level', () => {
    const result = plan(fullBrown(1, 1), { nagatinska: 2 });
    expect(result.buildings).toBe(1);
    expect(result.changes.map((change) => change.tileId)).toEqual(['nagatinska']);
  });

  it('skips a street whose target equals its level', () => {
    const result = plan(fullBrown(1, 0), { zhitna: 1, nagatinska: 1 });
    expect(result.changes.map((change) => change.tileId)).toEqual(['nagatinska']);
    expect(result.buildings).toBe(1);
  });

  it('counts a sale by the buildings removed', () => {
    const result = plan(fullBrown(3, 2), { zhitna: 1, nagatinska: 1 }, 'SELL');
    expect(result.buildings).toBe(3);
    expect(result.changes.map((change) => change.after.houses)).toEqual([1, 1]);
  });

  it('accepts the lowest and the highest level', () => {
    expect(plan(fullBrown(1, 1), { zhitna: 0, nagatinska: 0 }, 'SELL').buildings).toBe(2);
    expect(plan(fullBrown(4, 4), { zhitna: 5, nagatinska: 5 }).buildings).toBe(2);
  });

  it('refuses an empty plan, a level out of range and a fractional level', () => {
    expect(refused(fullBrown(0, 0), {})).toMatchObject({
      code: 'INVALID_BUILD_TARGET',
      status: 400,
      details: { reason: 'no street named' },
    });
    for (const level of [-1, 6, 1.5, Number.NaN])
      expect(refused(fullBrown(0, 0), { zhitna: level })).toMatchObject({
        code: 'INVALID_BUILD_TARGET',
        details: { reason: 'a level is 0 to 5', tileId: 'zhitna' },
      });
  });

  it('refuses streets of two colour groups', () => {
    const overrides = { ...fullBrown(0, 0), varshavske: { ownerPlayerId: 'a' } };
    expect(refused(overrides, { zhitna: 1, varshavske: 1 })).toMatchObject({
      code: 'INVALID_BUILD_TARGET',
      details: { reason: 'one colour group only', tileId: 'varshavske' },
    });
  });

  it('refuses a tile that is not a street and one that is not on the board', () => {
    expect(refused({ riga_rail: { ownerPlayerId: 'a' } }, { riga_rail: 1 })).toMatchObject({
      code: 'TILE_NOT_BUILDABLE',
    });
    expect(refused(fullBrown(0, 0), { nowhere: 1 })).toMatchObject({ code: 'TILE_NOT_FOUND' });
  });

  it('refuses a street the player does not own, a partial group and a mortgaged group', () => {
    expect(refused({ zhitna: { ownerPlayerId: 'b' } }, { zhitna: 1 })).toMatchObject({
      code: 'PROPERTY_NOT_OWNED',
      details: { tileId: 'zhitna' },
    });
    expect(refused({ zhitna: { ownerPlayerId: 'a' } }, { zhitna: 1 })).toMatchObject({
      code: 'BUILD_REQUIRES_FULL_GROUP',
      details: { tileId: 'zhitna' },
    });
    expect(
      refused(
        {
          zhitna: { ownerPlayerId: 'a' },
          nagatinska: { ownerPlayerId: 'a', mortgaged: true },
        },
        { zhitna: 1 },
      ),
    ).toMatchObject({ code: 'BUILD_MORTGAGED_GROUP', details: { tileId: 'zhitna' } });
  });

  it('refuses a build that removes buildings and a sale that adds them', () => {
    expect(refused(fullBrown(2, 2), { zhitna: 1 })).toMatchObject({
      code: 'INVALID_BUILD_TARGET',
      details: { reason: 'a build cannot remove buildings', tileId: 'zhitna' },
    });
    expect(refused(fullBrown(2, 2), { zhitna: 3 }, 'SELL')).toMatchObject({
      code: 'INVALID_BUILD_TARGET',
      details: { reason: 'a sale cannot add buildings', tileId: 'zhitna' },
    });
  });

  it('refuses a plan that changes nothing', () => {
    expect(refused(fullBrown(2, 2), { zhitna: 2, nagatinska: 2 })).toMatchObject({
      code: 'INVALID_BUILD_TARGET',
      details: { reason: 'nothing changes' },
    });
  });

  it('refuses final levels more than one apart, and allows exactly one apart', () => {
    expect(refused(fullBrown(0, 0), { zhitna: 2 })).toMatchObject({
      code: 'BUILD_UNEVEN',
      details: { tileId: 'zhitna' },
    });
    expect(plan(fullBrown(0, 0), { zhitna: 1 }).buildings).toBe(1);
    expect(refused(fullBrown(3, 3), { zhitna: 1 }, 'SELL')).toMatchObject({ code: 'BUILD_UNEVEN' });
  });

  it('allows levels further apart when even building is switched off', () => {
    expect(
      plan(fullBrown(0, 0), { zhitna: 3 }, 'BUILD', without({ buildEvenly: false })).buildings,
    ).toBe(3);
  });
});

describe('building prices', () => {
  it('prices a building from the snapshot and a non-street at nothing', () => {
    expect(buildCost(board, 'zhitna')).toBe(500_000);
    expect(buildCost(board, 'riga_rail')).toBe(0);
    expect(() => buildCost(board, 'nowhere')).toThrow(TileNotFoundError);
  });

  it('refunds half the house cost rounded down', () => {
    expect(sellRefund(board, 'zhitna')).toBe(250_000);
    const odd: BoardSnapshot = {
      ...board,
      tiles: board.tiles.map((tile) =>
        tile.type === 'street' && tile.id === 'zhitna' ? { ...tile, houseCost: 5 } : tile,
      ),
    };
    expect(sellRefund(odd, 'zhitna')).toBe(2);
    expect(sellRefund(board, 'riga_rail')).toBe(0);
  });

  it('describes a change of houses without touching the rest of the state', () => {
    expect(buildingChange('zhitna', { ownerPlayerId: 'a', mortgaged: true, houses: 1 }, 3)).toEqual(
      {
        tileId: 'zhitna',
        before: { ownerPlayerId: 'a', mortgaged: true, houses: 1 },
        after: { ownerPlayerId: 'a', mortgaged: true, houses: 3 },
      },
    );
  });
});

describe('rent boundaries', () => {
  it('charges the hotel rent for a hotel', () => {
    expect(rentFor(board, registry(fullBrown(5, 5)), 'zhitna')).toBe(2_500_000);
  });

  it('refuses a dice sum on a railway and requires one on a utility, with the reason', () => {
    expect(
      attempt(() =>
        rentFor(board, registry({ riga_rail: { ownerPlayerId: 'a' } }), 'riga_rail', 7),
      ),
    ).toMatchObject({ code: 'VALIDATION_ERROR', message: 'diceSum applies to utilities only.' });
    expect(
      attempt(() => rentFor(board, registry({ zhitna: { ownerPlayerId: 'a' } }), 'zhitna', 7)),
    ).toMatchObject({ message: 'diceSum applies to utilities only.' });
    expect(
      attempt(() =>
        rentFor(board, registry({ power_plant: { ownerPlayerId: 'a' } }), 'power_plant'),
      ),
    ).toMatchObject({ message: 'diceSum is required to pay the rent of a utility.' });
  });

  it('multiplies the dice sum by the multiplier for the utilities held', () => {
    const one = registry({ power_plant: { ownerPlayerId: 'a' } });
    expect(rentFor(board, one, 'power_plant', 7)).toBe(28_000);
    const both = registry({
      power_plant: { ownerPlayerId: 'a' },
      waterworks: { ownerPlayerId: 'a' },
    });
    expect(rentFor(board, both, 'waterworks', 7)).toBe(70_000);
  });

  it('refuses a missing rent entry as an unknown tile', () => {
    const noRent: BoardSnapshot = {
      ...board,
      tiles: board.tiles.map((tile) =>
        tile.id === 'zhitna' && tile.type === 'street' ? { ...tile, rent: undefined } : tile,
      ),
    };
    expect(
      attempt(() => rentFor(noRent, registry({ zhitna: { ownerPlayerId: 'a' } }), 'zhitna')),
    ).toMatchObject({
      code: 'TILE_NOT_FOUND',
    });
    const noRailwayRent = without({ railwayRent: {} });
    expect(
      attempt(() =>
        rentFor(noRailwayRent, registry({ riga_rail: { ownerPlayerId: 'a' } }), 'riga_rail'),
      ),
    ).toMatchObject({ code: 'TILE_NOT_FOUND' });
    const noUtilityRent = without({ utilityDiceMultiplier: {} });
    expect(
      attempt(() =>
        rentFor(noUtilityRent, registry({ power_plant: { ownerPlayerId: 'a' } }), 'power_plant', 3),
      ),
    ).toMatchObject({ code: 'TILE_NOT_FOUND' });
  });
});

describe('registry change details', () => {
  it('clears houses and the mortgage when a tile goes back to the bank', () => {
    expect(
      ownerChange('zhitna', { ownerPlayerId: 'a', mortgaged: true, houses: 2 }, null).after,
    ).toEqual({ ownerPlayerId: null, mortgaged: false, houses: 0 });
  });

  it('keeps houses and the mortgage when a tile passes to another player', () => {
    expect(
      ownerChange('zhitna', { ownerPlayerId: 'a', mortgaged: true, houses: 2 }, 'b').after,
    ).toEqual({ ownerPlayerId: 'b', mortgaged: true, houses: 2 });
  });

  it('applies a change to its own tile only', () => {
    const before = registry({ zhitna: { ownerPlayerId: 'a' } });
    const after = applyChanges(before, [
      mortgageChange('zhitna', { ownerPlayerId: 'a', mortgaged: false, houses: 0 }, true),
    ]);
    expect(after.filter((row) => row.mortgaged).map((row) => row.tileId)).toEqual(['zhitna']);
    expect(after).toHaveLength(before.length);
  });
});

describe('the tile picker order and the offending streets', () => {
  const item = (id: string, ownerPlayerId: string | null = null) => ({
    tile: requireTile(board, id) as Extract<ReturnType<typeof requireTile>, { type: 'street' }>,
    ownerPlayerId,
  });

  it('puts the lower board position first when prices are equal', () => {
    const sections = orderTilesForPicker([item('ogarova'), item('varshavske')]);
    expect(sections[0]?.groups[0]?.items.map((entry) => entry.tile.id)).toEqual([
      'varshavske',
      'ogarova',
    ]);
  });

  it('keeps every tile of a group together, cheapest tile first, and splits free from owned', () => {
    const sections = orderTilesForPicker([
      item('persha_parkova', 'a'),
      item('zhitna'),
      item('varshavske'),
      item('nagatinska'),
      item('ogarova', 'b'),
    ]);
    expect(sections.map((section) => section.kind)).toEqual(['free', 'owned']);
    expect(
      sections[0]?.groups.map((group) => [group.group, group.items.map((entry) => entry.tile.id)]),
    ).toEqual([
      ['brown', ['zhitna', 'nagatinska']],
      ['lightblue', ['varshavske']],
    ]);
    expect(
      sections[1]?.groups.map((group) => [group.group, group.items.map((entry) => entry.tile.id)]),
    ).toEqual([['lightblue', ['ogarova', 'persha_parkova']]]);
  });

  it('marks nothing for a plan that is only one level apart', () => {
    const state = context(fullBrown(0, 0));
    expect(
      offendingStreets(state, 'zhitna', 'BUILD_UNEVEN', { zhitna: 1, nagatinska: 0 }, 'BUILD'),
    ).toEqual([]);
    expect(
      offendingStreets(state, 'zhitna', 'BUILD_UNEVEN', { zhitna: 2, nagatinska: 0 }, 'BUILD'),
    ).toEqual(['zhitna']);
  });

  it('marks the streets that fall too far behind in a sale', () => {
    const state = context(fullBrown(1, 3));
    expect(offendingStreets(state, 'zhitna', 'BUILD_UNEVEN', {}, 'SELL')).toEqual(['zhitna']);
    expect(offendingStreets(state, 'zhitna', 'BUILD_UNEVEN', { zhitna: 2 }, 'SELL')).toEqual([]);
  });

  it('takes the level of a street left out from the registry', () => {
    const state = context(fullBrown(0, 3));
    expect(offendingStreets(state, 'zhitna', 'BUILD_UNEVEN', {}, 'BUILD')).toEqual(['nagatinska']);
  });
});
