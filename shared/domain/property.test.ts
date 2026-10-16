import { describe, expect, it } from 'vitest';
import type { BoardSnapshot } from '../board/types.js';
import type { GameProperty } from '../types/monopoly.js';
import { buildGameSettings } from './game-rules.js';
import {
  applyChanges,
  canMortgage,
  DiceSumError,
  invertChanges,
  mortgageChange,
  ownerChange,
  PropertyMortgagedError,
  PropertyNotOwnedError,
  purchasePrice,
  rentFor,
  requireTile,
  TileNotFoundError,
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
  it('charges 4 times the dice sum for one utility and 10 times for both', () => {
    expect(rentFor(board, registry({ power_plant: owned() }), 'power_plant', 7)).toBe(28);
    expect(
      rentFor(board, registry({ power_plant: owned(), waterworks: owned() }), 'power_plant', 7),
    ).toBe(70);
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
