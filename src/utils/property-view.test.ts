import { describe, expect, it } from 'vitest';
import { buildBoardSnapshot, getBoardPreset } from '../../shared/board';
import type { BoardSnapshot, PropertyGroupId, PropertyTile } from '../../shared/board';
import type { GameProperty } from '../../shared/types/monopoly';
import {
  buildableTiles,
  buildingGroups,
  boardStrip,
  cardsByGroup,
  cardsOwnedBy,
  cardsValue,
  freeTiles,
  groupOrder,
  groupProgress,
  groupStreets,
  isDiceSum,
  levelBounds,
  mergeProperties,
  mortgageableTiles,
  playerStrip,
  propertyGroupColors,
  previewBuildings,
  registryOf,
  rentableTiles,
  rentDue,
  sellableTiles,
  tileIntents,
  tileRent,
  tileViews,
} from './property-view';

const board = buildBoardSnapshot(getBoardPreset('monopoly-ru-2012'), 100_000);
const row = (tileId: string, over: Partial<GameProperty> = {}): GameProperty => ({
  gameId: 'g',
  tileId,
  ownerPlayerId: 'a',
  mortgaged: false,
  houses: 0,
  ...over,
});
const rentOf = (properties: GameProperty[], tileId: string) => {
  const views = tileViews(board, properties);
  const view = views.find((candidate) => candidate.tile.id === tileId)!;
  return tileRent(board, views, view);
};

describe('property view', () => {
  it('lists every catalog tile, free when there is no registry row', () => {
    const views = tileViews(board, [row('zhitna', { mortgaged: true })]);
    expect(views).toHaveLength(board.tiles.length);
    expect(views.find((view) => view.tile.id === 'zhitna')?.status).toBe('mortgaged');
    expect(views.find((view) => view.tile.id === 'nagatinska')?.status).toBe('free');
  });

  it('counts group progress and flags a monopoly', () => {
    const partial = tileViews(board, [row('zhitna')]);
    expect(groupProgress(partial, 'brown', 'a')).toEqual({ owned: 1, size: 2, monopoly: false });
    const full = tileViews(board, [row('zhitna'), row('nagatinska')]);
    expect(groupProgress(full, 'brown', 'a').monopoly).toBe(true);
    expect(groupProgress(full, 'brown', 'b').owned).toBe(0);
  });

  it('selects the cards of the given wallets and sums their price', () => {
    const views = tileViews(board, [row('zhitna'), row('nagatinska', { ownerPlayerId: 'b' })]);
    const mine = cardsOwnedBy(views, ['a']);
    expect(mine.map((view) => view.tile.id)).toEqual(['zhitna']);
    expect(cardsValue(mine)).toBe(mine[0]!.tile.price);
  });

  it('charges base rent, doubled for a full unimproved group', () => {
    const zhitna = board.tiles.find((tile) => tile.id === 'zhitna')!;
    expect(rentOf([row('zhitna')], 'zhitna')).toMatchObject({ amount: zhitna.rent![0], level: 0 });
    expect(rentOf([row('zhitna'), row('nagatinska')], 'zhitna')).toMatchObject({
      amount: zhitna.rent![0] * 2,
      monopolyDoubled: true,
    });
  });

  it('uses the house level and the hotel, and nothing for mortgaged or free tiles', () => {
    const zhitna = board.tiles.find((tile) => tile.id === 'zhitna')!;
    const group = [row('zhitna', { houses: 3 }), row('nagatinska', { houses: 3 })];
    expect(rentOf(group, 'zhitna')).toMatchObject({ amount: zhitna.rent![3], level: 3 });
    expect(rentOf([row('zhitna', { houses: 5 })], 'zhitna')).toMatchObject({ level: 5 });
    expect(rentOf([row('zhitna', { mortgaged: true })], 'zhitna')).toEqual({ kind: 'none' });
    expect(rentOf([], 'zhitna')).toEqual({ kind: 'none' });
  });

  it('prices railways by count and shows utilities as a dice multiple', () => {
    expect(rentOf([row('riga_rail')], 'riga_rail')).toMatchObject({
      amount: board.rules.railwayRent['1'],
      level: 1,
    });
    expect(rentOf([row('riga_rail'), row('kursk_rail')], 'riga_rail')).toMatchObject({
      amount: board.rules.railwayRent['2'],
    });
    expect(rentOf([row('power_plant')], 'power_plant')).toEqual({
      kind: 'dice',
      multiplier: 4,
      count: 1,
    });
    expect(rentOf([row('power_plant'), row('waterworks')], 'power_plant')).toMatchObject({
      multiplier: 10,
    });
  });
});

describe('building intents', () => {
  const brown = (a = 0, b = 0, over: Partial<GameProperty> = {}) => [
    row('zhitna', { houses: a, ...over }),
    row('nagatinska', { houses: b }),
  ];
  const ids = (views: { tile: { id: string } }[]) => views.map((view) => view.tile.id);

  it('offers building only on streets of a full group, evenly', () => {
    expect(ids(buildableTiles(board, tileViews(board, brown()), 'a'))).toEqual([
      'zhitna',
      'nagatinska',
    ]);
    expect(ids(buildableTiles(board, tileViews(board, brown(1, 0)), 'a'))).toEqual(['nagatinska']);
    expect(buildableTiles(board, tileViews(board, [row('zhitna')]), 'a')).toEqual([]);
    expect(buildableTiles(board, tileViews(board, brown()), 'b')).toEqual([]);
    expect(buildableTiles(board, tileViews(board, brown(0, 0, { mortgaged: true })), 'a')).toEqual(
      [],
    );
  });

  it('offers selling only where a building stands and the group is even', () => {
    expect(sellableTiles(board, tileViews(board, brown()), 'a')).toEqual([]);
    expect(ids(sellableTiles(board, tileViews(board, brown(2, 1)), 'a'))).toEqual(['zhitna']);
  });

  it('adds Build and Sell building to the owner sheet of a controlled wallet', () => {
    const views = tileViews(board, brown(1, 1));
    const view = views.find((candidate) => candidate.tile.id === 'zhitna')!;
    const kinds = (controlled: string[]) =>
      tileIntents(board, views, view, {
        controlledPlayerIds: controlled,
        actorPlayerId: 'a',
        auctionsAvailable: false,
      }).map((intent) => intent.kind);
    expect(kinds(['a'])).toEqual(
      expect.arrayContaining(['PROPERTY_BUILD', 'PROPERTY_SELL_BUILDING']),
    );
    expect(kinds(['b'])).not.toContain('PROPERTY_BUILD');
  });
});

describe('trade intents', () => {
  const kindsFor = (
    properties: GameProperty[],
    tileId: string,
    options: { controlled: string[]; actor: string | null },
  ) => {
    const views = tileViews(board, properties);
    const view = views.find((candidate) => candidate.tile.id === tileId)!;
    return tileIntents(board, views, view, {
      controlledPlayerIds: options.controlled,
      actorPlayerId: options.actor,
      auctionsAvailable: false,
    }).filter((intent) => intent.kind === 'PROPERTY_TRANSFER');
  };

  it("offers a trade on an own tile (owner wallet) and on another player's tile (acting wallet)", () => {
    expect(kindsFor([row('zhitna')], 'zhitna', { controlled: ['a'], actor: 'a' })).toEqual([
      { kind: 'PROPERTY_TRANSFER', tileId: 'zhitna', playerId: 'a' },
    ]);
    expect(
      kindsFor([row('zhitna', { ownerPlayerId: 'b' })], 'zhitna', {
        controlled: ['a'],
        actor: 'a',
      }),
    ).toEqual([{ kind: 'PROPERTY_TRANSFER', tileId: 'zhitna', playerId: 'a' }]);
  });

  it('offers nothing on a free tile, without an acting wallet, or in a group with buildings', () => {
    expect(kindsFor([], 'zhitna', { controlled: ['a'], actor: 'a' })).toEqual([]);
    expect(
      kindsFor([row('zhitna', { ownerPlayerId: 'b' })], 'zhitna', { controlled: [], actor: null }),
    ).toEqual([]);
    expect(
      kindsFor([row('zhitna'), row('nagatinska', { houses: 1 })], 'zhitna', {
        controlled: ['a'],
        actor: 'a',
      }),
    ).toEqual([]);
  });
});

describe('group order and sections', () => {
  const views = tileViews(board, []);

  it('orders the groups by their cheapest tile', () => {
    expect(groupOrder(views)).toEqual([
      'brown',
      'lightblue',
      'pink',
      'utility',
      'orange',
      'railway',
      'red',
      'yellow',
      'green',
      'blue',
    ]);
  });

  it('sorts a group by price, ties by board position', () => {
    const order = groupOrder(views);
    for (const { cards } of cardsByGroup(views, order)) {
      const keys = cards.map((card) => [card.tile.price, card.tile.pos]);
      expect(keys).toEqual([...keys].sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!));
    }
  });

  it('drops groups without cards', () => {
    const only = views.filter((view) => view.tile.group === 'blue');
    expect(cardsByGroup(only, groupOrder(views)).map((entry) => entry.group)).toEqual(['blue']);
  });
});

describe('ownership strips', () => {
  const tileOf = (group: PropertyGroupId, index = 0) =>
    board.tiles.filter((tile) => tile.group === group)[index]!.id;
  const blue = tileOf('blue');
  const brown = tileOf('brown');
  const orange = tileOf('orange');
  const views = tileViews(board, [
    row(blue, { ownerPlayerId: 'a' }),
    row(orange, { ownerPlayerId: 'b' }),
    row(brown, { ownerPlayerId: 'a', mortgaged: true }),
  ]);
  const colors = new Map([
    ['a', '#e11d48'],
    ['b', '#7c3aed'],
  ]);

  it("lists a player's cards from the cheapest group to the dearest", () => {
    expect(playerStrip(views, 'a')).toEqual([
      { tileId: brown, group: 'brown', color: propertyGroupColors.brown, owned: true },
      { tileId: blue, group: 'blue', color: propertyGroupColors.blue, owned: true },
    ]);
    expect(playerStrip(views, 'c')).toEqual([]);
  });

  it("shows every tile, solid when held, ringed for the viewer's wallets", () => {
    const strip = boardStrip(views, ['a'], colors);
    expect(strip).toHaveLength(board.tiles.length);
    expect(strip[0]).toEqual({
      tileId: brown,
      group: 'brown',
      color: propertyGroupColors.brown,
      owned: true,
      ring: '#e11d48',
    });
    expect(strip.at(-1)?.color).toBe(propertyGroupColors.blue);
    expect(strip.find((card) => card.tileId === orange)).toEqual({
      tileId: orange,
      group: 'orange',
      color: propertyGroupColors.orange,
      owned: true,
    });
    expect(strip.filter((card) => card.owned)).toHaveLength(3);
  });
});

describe('property view helpers', () => {
  const views = (properties: GameProperty[]) => tileViews(board, properties);
  const tileOf = (id: string) => board.tiles.find((tile) => tile.id === id)!;
  const viewOf = (list: ReturnType<typeof tileViews>, id: string) =>
    list.find((candidate) => candidate.tile.id === id)!;
  const ids = (list: ReturnType<typeof tileViews>) => list.map((view) => view.tile.id);

  it('merges changed rows into the loaded registry by tile, keeping the rest', () => {
    const current = [row('zhitna'), row('nagatinska')];
    const merged = mergeProperties(current, [
      row('nagatinska', { ownerPlayerId: 'b' }),
      row('arbat'),
    ]);
    expect(merged.map((item) => [item.tileId, item.ownerPlayerId])).toEqual([
      ['zhitna', 'a'],
      ['nagatinska', 'b'],
      ['arbat', 'a'],
    ]);
    expect(mergeProperties(undefined, [row('zhitna')])).toEqual([row('zhitna')]);
    expect(mergeProperties(current, [])).toEqual(current);
  });

  it('accepts only whole dice totals from 2 to 12', () => {
    for (const value of [2, 7, 12]) expect(isDiceSum(value)).toBe(true);
    for (const value of [1, 13, 0, -7, 7.5, Number.NaN]) expect(isDiceSum(value)).toBe(false);
  });

  it('owes the rent of a street or railway, and the dice multiple of a utility once the dice are known', () => {
    const list = views([
      row('zhitna'),
      row('riga_rail'),
      row('power_plant'),
      row('waterworks'),
      row('arbat', { ownerPlayerId: null }),
    ]);
    expect(rentDue(board, list, viewOf(list, 'zhitna'))).toBe(tileOf('zhitna').rent![0]);
    expect(rentDue(board, list, viewOf(list, 'riga_rail'))).toBe(board.rules.railwayRent['1']);
    expect(rentDue(board, list, viewOf(list, 'power_plant'), 7)).toBe(70_000);
    expect(rentDue(board, list, viewOf(list, 'power_plant'), 2)).toBe(20_000);
    expect(rentDue(board, list, viewOf(list, 'power_plant'), 12)).toBe(120_000);
    expect(rentDue(board, list, viewOf(list, 'power_plant'))).toBeNull();
    expect(rentDue(board, list, viewOf(list, 'power_plant'), 1)).toBeNull();
    expect(rentDue(board, list, viewOf(list, 'power_plant'), 13)).toBeNull();
    expect(rentDue(board, list, viewOf(list, 'arbat'))).toBeNull();
  });

  it('owes nothing on a mortgaged tile', () => {
    const list = views([row('zhitna', { mortgaged: true })]);
    expect(rentDue(board, list, viewOf(list, 'zhitna'))).toBeNull();
  });

  it('lists free tiles, a player’s mortgageable tiles and the tiles a payer may pay rent on', () => {
    const list = views([
      row('zhitna'),
      row('nagatinska', { ownerPlayerId: 'b' }),
      row('varshavske', { mortgaged: true }),
      row('ogarova', { houses: 1 }),
      row('persha_parkova'),
    ]);
    expect(freeTiles(list)).toHaveLength(board.tiles.length - 5);
    expect(freeTiles(list).every((view) => view.status === 'free')).toBe(true);
    expect(ids(mortgageableTiles(list, 'a'))).toEqual(['zhitna']);
    expect(ids(mortgageableTiles(list, 'b'))).toEqual(['nagatinska']);
    expect(ids(rentableTiles(list, 'a'))).toEqual(['nagatinska']);
    expect(ids(rentableTiles(list, 'b'))).toEqual(['zhitna', 'ogarova', 'persha_parkova']);
    expect(rentableTiles(list, 'c').map((view) => view.tile.id)).toEqual([
      'zhitna',
      'nagatinska',
      'ogarova',
      'persha_parkova',
    ]);
  });

  it('turns the views back into registry rows for the shared rules', () => {
    const list = views([row('zhitna', { houses: 2, mortgaged: false })]);
    const registry = registryOf(list);
    expect(registry).toHaveLength(board.tiles.length);
    expect(registry.find((item) => item.tileId === 'zhitna')).toEqual({
      gameId: '',
      tileId: 'zhitna',
      ownerPlayerId: 'a',
      mortgaged: false,
      houses: 2,
    });
    expect(registry.find((item) => item.tileId === 'arbat')).toMatchObject({
      ownerPlayerId: null,
      houses: 0,
    });
  });

  it('bounds the level a street may be set to in each mode', () => {
    const view = viewOf(views([row('zhitna', { houses: 2 })]), 'zhitna');
    expect(levelBounds(view, 'BUILD')).toEqual({ min: 2, max: 5 });
    expect(levelBounds(view, 'SELL')).toEqual({ min: 0, max: 2 });
  });

  it('lists the streets of a group in board order', () => {
    expect(ids(groupStreets(views([]), 'brown'))).toEqual(['zhitna', 'nagatinska']);
    expect(groupStreets(views([]), 'utility')).toHaveLength(2);
  });

  it('lists the groups where a player may build or sell, once each', () => {
    const list = views([row('zhitna'), row('nagatinska'), row('varshavske'), row('ogarova')]);
    expect(buildingGroups(board, list, 'a', 'BUILD')).toEqual(['brown']);
    expect(buildingGroups(board, list, 'a', 'SELL')).toEqual([]);
    const built = views([row('zhitna', { houses: 1 }), row('nagatinska')]);
    expect(buildingGroups(board, built, 'a', 'SELL')).toEqual(['brown']);
    expect(buildingGroups(board, built, 'b', 'BUILD')).toEqual([]);
  });
});

describe('previewBuildings', () => {
  const brown = (zhitna: number, nagatinska: number) =>
    tileViews(board, [
      row('zhitna', { houses: zhitna }),
      row('nagatinska', { houses: nagatinska }),
    ]);
  const cost = board.tiles.find((tile) => tile.id === 'zhitna')!.houseCost!;

  it('prices a build by the buildings added and reports only the streets that change', () => {
    expect(
      previewBuildings(board, brown(0, 0), 'a', { zhitna: 1, nagatinska: 0 }, 'BUILD'),
    ).toEqual({ ok: true, targets: { zhitna: 1 }, buildings: 1, amount: cost });
    expect(
      previewBuildings(board, brown(0, 0), 'a', { zhitna: 2, nagatinska: 1 }, 'BUILD'),
    ).toEqual({ ok: true, targets: { zhitna: 2, nagatinska: 1 }, buildings: 3, amount: 3 * cost });
  });

  it('prices a sale by the refund for each building', () => {
    const refund = Math.floor(cost * board.rules.sellBuildingRefund);
    expect(previewBuildings(board, brown(2, 2), 'a', { zhitna: 1, nagatinska: 1 }, 'SELL')).toEqual(
      {
        ok: true,
        targets: { zhitna: 1, nagatinska: 1 },
        buildings: 2,
        amount: 2 * refund,
      },
    );
  });

  it('says nothing changed when every level is already where it is set', () => {
    expect(
      previewBuildings(board, brown(1, 1), 'a', { zhitna: 1, nagatinska: 1 }, 'BUILD'),
    ).toEqual({
      ok: false,
      reason: 'NOTHING',
    });
    expect(previewBuildings(board, brown(1, 1), 'a', {}, 'BUILD')).toEqual({
      ok: false,
      reason: 'NOTHING',
    });
  });

  it('reports the rule that refuses the plan', () => {
    expect(previewBuildings(board, brown(0, 0), 'a', { zhitna: 2 }, 'BUILD')).toEqual({
      ok: false,
      reason: 'BUILD_UNEVEN',
    });
    expect(previewBuildings(board, brown(0, 0), 'b', { zhitna: 1 }, 'BUILD')).toEqual({
      ok: false,
      reason: 'PROPERTY_NOT_OWNED',
    });
    expect(previewBuildings(board, brown(2, 2), 'a', { zhitna: 1 }, 'BUILD')).toEqual({
      ok: false,
      reason: 'INVALID_BUILD_TARGET',
    });
    expect(
      previewBuildings(
        board,
        tileViews(board, [row('zhitna'), row('nagatinska', { mortgaged: true })]),
        'a',
        { zhitna: 1 },
        'BUILD',
      ),
    ).toEqual({ ok: false, reason: 'BUILD_MORTGAGED_GROUP' });
  });

  it('treats a street with no registry row as having no buildings', () => {
    expect(previewBuildings(board, tileViews(board, []), 'a', { nowhere: 0 }, 'BUILD')).toEqual({
      ok: false,
      reason: 'NOTHING',
    });
  });
});

describe('tile intents on a sheet', () => {
  const options = (patch: Partial<Parameters<typeof tileIntents>[3]> = {}) => ({
    controlledPlayerIds: ['a'],
    actorPlayerId: 'a',
    auctionsAvailable: true,
    ...patch,
  });
  const intents = (
    properties: GameProperty[],
    tileId: string,
    patch: Partial<Parameters<typeof tileIntents>[3]> = {},
  ) => {
    const list = tileViews(board, properties);
    return tileIntents(
      board,
      list,
      list.find((view) => view.tile.id === tileId)!,
      options(patch),
    ).map((intent) => intent.kind);
  };

  it('offers a free tile for purchase, and for auction only when auctions are on', () => {
    expect(intents([], 'zhitna')).toEqual(['PROPERTY_PURCHASE', 'AUCTION']);
    expect(intents([], 'zhitna', { auctionsAvailable: false })).toEqual(['PROPERTY_PURCHASE']);
    expect(intents([], 'zhitna', { actorPlayerId: null })).toEqual([]);
  });

  it('names the acting wallet in a purchase and the owning wallet in an owner action', () => {
    const list = tileViews(board, [row('zhitna')]);
    expect(
      tileIntents(
        board,
        list,
        list.find((view) => view.tile.id === 'arbat')!,
        options({ actorPlayerId: 'c' }),
      ),
    ).toEqual([
      { kind: 'PROPERTY_PURCHASE', tileId: 'arbat', playerId: 'c' },
      { kind: 'AUCTION', tileId: 'arbat', playerId: 'c' },
    ]);
    expect(
      tileIntents(
        board,
        list,
        list.find((view) => view.tile.id === 'zhitna')!,
        options({ actorPlayerId: 'c' }),
      ),
    ).toEqual([
      { kind: 'MORTGAGE', tileId: 'zhitna', playerId: 'a' },
      { kind: 'PAY_RENT', tileId: 'zhitna', playerId: 'c' },
      { kind: 'PROPERTY_TRANSFER', tileId: 'zhitna', playerId: 'a' },
    ]);
  });

  it('offers an owner a mortgage, or a redemption when it is already mortgaged', () => {
    expect(intents([row('zhitna')], 'zhitna')).toContain('MORTGAGE');
    expect(intents([row('zhitna')], 'zhitna')).not.toContain('MORTGAGE_REDEMPTION');
    expect(intents([row('zhitna', { mortgaged: true })], 'zhitna')).toContain(
      'MORTGAGE_REDEMPTION',
    );
    expect(intents([row('zhitna', { mortgaged: true })], 'zhitna')).not.toContain('MORTGAGE');
  });

  it('does not offer a mortgage on a tile whose group has buildings', () => {
    const built = [row('zhitna'), row('nagatinska', { houses: 1 })];
    expect(intents(built, 'zhitna')).not.toContain('MORTGAGE');
  });

  it('offers rent to another wallet’s tile, but not on a mortgaged tile or your own', () => {
    expect(intents([row('zhitna', { ownerPlayerId: 'b' })], 'zhitna')).toContain('PAY_RENT');
    expect(
      intents([row('zhitna', { ownerPlayerId: 'b', mortgaged: true })], 'zhitna'),
    ).not.toContain('PAY_RENT');
    expect(intents([row('zhitna')], 'zhitna')).not.toContain('PAY_RENT');
    expect(
      intents([row('zhitna', { ownerPlayerId: 'b' })], 'zhitna', { actorPlayerId: null }),
    ).not.toContain('PAY_RENT');
  });

  it('does not offer owner actions on a tile of a wallet the viewer does not control', () => {
    const kinds = intents([row('zhitna', { ownerPlayerId: 'b' })], 'zhitna');
    expect(kinds).not.toContain('MORTGAGE');
    expect(kinds).not.toContain('MORTGAGE_REDEMPTION');
    expect(kinds).not.toContain('PROPERTY_BUILD');
  });

  it('offers a trade from the owning wallet, or from the acting wallet on another’s tile', () => {
    expect(intents([row('zhitna')], 'zhitna')).toContain('PROPERTY_TRANSFER');
    const list = tileViews(board, [row('zhitna', { ownerPlayerId: 'b' })]);
    expect(
      tileIntents(
        board,
        list,
        list.find((view) => view.tile.id === 'zhitna')!,
        options(),
      ).find((intent) => intent.kind === 'PROPERTY_TRANSFER'),
    ).toEqual({ kind: 'PROPERTY_TRANSFER', tileId: 'zhitna', playerId: 'a' });
    expect(
      intents([row('zhitna', { ownerPlayerId: 'a' })], 'zhitna', { actorPlayerId: 'a' }),
    ).toContain('PROPERTY_TRANSFER');
  });
});

describe('property view on a custom catalog', () => {
  const base = board.tiles.find((tile) => tile.id === 'zhitna')!;
  const tile = (
    id: string,
    group: PropertyGroupId,
    price: number,
    pos: number,
    over: Partial<PropertyTile> = {},
  ): PropertyTile => ({ ...base, id, group, price, pos, ...over });
  const boardOf = (tiles: PropertyTile[], over: Partial<BoardSnapshot> = {}): BoardSnapshot => ({
    ...board,
    tiles,
    ...over,
  });
  const viewsOf = (tiles: PropertyTile[], properties: GameProperty[] = []) =>
    tileViews(boardOf(tiles), properties);
  const ids = (list: { tile: { id: string } }[]) => list.map((view) => view.tile.id);

  it('describes a tile without a registry row as free, unmortgaged and unbuilt', () => {
    expect(viewsOf([tile('t', 'brown', 10, 1)])[0]).toMatchObject({
      ownerPlayerId: null,
      mortgaged: false,
      houses: 0,
      status: 'free',
    });
  });

  it('never calls an empty group a monopoly', () => {
    expect(groupProgress([], 'brown', 'a')).toEqual({ owned: 0, size: 0, monopoly: false });
  });

  it('orders groups by their cheapest tile and breaks price ties by board position', () => {
    const list = viewsOf([
      tile('b1', 'brown', 200, 10),
      tile('b2', 'brown', 100, 20),
      tile('p1', 'pink', 120, 30),
      tile('p2', 'pink', 300, 12),
      tile('r1', 'red', 110, 1),
      tile('y1', 'yellow', 200, 2),
    ]);
    expect(groupOrder(list)).toEqual(['brown', 'red', 'pink', 'yellow']);
    const ties = viewsOf([
      tile('a1', 'green', 50, 9),
      tile('a2', 'green', 50, 4),
      tile('a3', 'green', 50, 8),
      tile('c1', 'blue', 50, 6),
      tile('d1', 'orange', 50, 7),
    ]);
    expect(groupOrder(ties)).toEqual(['green', 'blue', 'orange']);
    const apart = viewsOf([
      tile('x', 'brown', 50, 7),
      tile('y', 'pink', 50, 3),
      tile('z', 'red', 50, 5),
    ]);
    expect(groupOrder(apart)).toEqual(['pink', 'red', 'brown']);
  });

  it('keeps only the cards of each group and sorts them by price, then board position', () => {
    const list = viewsOf([
      tile('a', 'brown', 300, 1),
      tile('b', 'brown', 100, 9),
      tile('c', 'brown', 100, 5),
      tile('d', 'brown', 200, 2),
      tile('e', 'pink', 10, 3),
    ]);
    const entries = cardsByGroup(list, ['brown', 'pink', 'red']);
    expect(entries.map((entry) => entry.group)).toEqual(['brown', 'pink']);
    expect(ids(entries[0]!.cards)).toEqual(['c', 'b', 'd', 'a']);
    expect(ids(entries[1]!.cards)).toEqual(['e']);
  });

  it('puts no rent on a railway or utility the rules do not price, nor on a street without rent', () => {
    const noRules = boardOf(
      [
        tile('rail', 'railway', 10, 1, { type: 'railway', rent: undefined }),
        tile('util', 'utility', 10, 2, { type: 'utility', rent: undefined }),
        tile('plain', 'brown', 10, 3, { rent: undefined }),
      ],
      { rules: { ...board.rules, railwayRent: {}, utilityDiceMultiplier: {} } },
    );
    const list = tileViews(noRules, [row('rail'), row('util'), row('plain')]);
    for (const view of list) expect(tileRent(noRules, list, view)).toEqual({ kind: 'none' });
    for (const view of list) expect(rentDue(noRules, list, view, 7)).toBeNull();
  });

  it('describes a railway and a street with houses exactly', () => {
    const zhitna = board.tiles.find((candidate) => candidate.id === 'zhitna')!;
    expect(rentOf([row('riga_rail')], 'riga_rail')).toEqual({
      kind: 'amount',
      amount: board.rules.railwayRent['1'],
      level: 1,
      monopolyDoubled: false,
    });
    expect(rentOf([row('zhitna', { houses: 2 })], 'zhitna')).toEqual({
      kind: 'amount',
      amount: zhitna.rent![2],
      level: 2,
      monopolyDoubled: false,
    });
  });

  it('does not double a full group while one of its streets has a house, nor for houses elsewhere', () => {
    const zhitna = board.tiles.find((candidate) => candidate.id === 'zhitna')!;
    const built = rentOf([row('zhitna'), row('nagatinska', { houses: 1 })], 'zhitna');
    expect(built).toEqual({
      kind: 'amount',
      amount: zhitna.rent![0],
      level: 0,
      monopolyDoubled: false,
    });
    const elsewhere = rentOf(
      [row('zhitna'), row('nagatinska'), row('varshavske', { houses: 1 })],
      'zhitna',
    );
    expect(elsewhere).toEqual({
      kind: 'amount',
      amount: zhitna.rent![0] * board.rules.monopolyBaseRentMultiplier,
      level: 0,
      monopolyDoubled: true,
    });
  });

  it('owes nothing on a free or mortgaged tile even with a dice total', () => {
    const list = tileViews(board, [row('power_plant', { mortgaged: true })]);
    const mortgaged = list.find((view) => view.tile.id === 'power_plant')!;
    const free = list.find((view) => view.tile.id === 'waterworks')!;
    expect(rentDue(board, list, mortgaged, 7)).toBeNull();
    expect(rentDue(board, list, free, 7)).toBeNull();
  });

  it('reports an unexpected failure of the plan as invalid', () => {
    const broken = { ...board, tiles: undefined } as unknown as BoardSnapshot;
    const list = tileViews(board, [row('zhitna'), row('nagatinska')]);
    expect(previewBuildings(broken, list, 'a', { zhitna: 1 }, 'BUILD')).toEqual({
      ok: false,
      reason: 'INVALID',
    });
  });

  it('compares a level with the current level of that very street', () => {
    const list = tileViews(board, [row('zhitna', { houses: 1 }), row('nagatinska', { houses: 2 })]);
    expect(previewBuildings(board, list, 'a', { nagatinska: 2 }, 'BUILD')).toEqual({
      ok: false,
      reason: 'NOTHING',
    });
    expect(previewBuildings(board, list, 'a', { zhitna: 1, nagatinska: 2 }, 'BUILD')).toEqual({
      ok: false,
      reason: 'NOTHING',
    });
  });
});

describe('tile intents tied to the viewed tile', () => {
  const kindsOn = (
    properties: GameProperty[],
    tileId: string,
    options: { controlled: string[]; actor: string | null },
  ) => {
    const list = tileViews(board, properties);
    return tileIntents(
      board,
      list,
      list.find((view) => view.tile.id === tileId)!,
      {
        controlledPlayerIds: options.controlled,
        actorPlayerId: options.actor,
        auctionsAvailable: false,
      },
    ).map((intent) => intent.kind);
  };
  const mine = { controlled: ['a'], actor: 'a' };

  it('offers a mortgage only when this tile may be mortgaged, not because another may', () => {
    const properties = [
      row('zhitna', { houses: 1 }),
      row('nagatinska', { houses: 1 }),
      row('arbat'),
    ];
    expect(kindsOn(properties, 'nagatinska', mine)).not.toContain('MORTGAGE');
    expect(kindsOn(properties, 'arbat', mine)).toContain('MORTGAGE');
  });

  it('offers building and selling only for the viewed tile', () => {
    const properties = [
      row('zhitna', { houses: 1 }),
      row('nagatinska', { houses: 1 }),
      row('arbat'),
    ];
    const kinds = kindsOn(properties, 'arbat', mine);
    expect(kinds).not.toContain('PROPERTY_BUILD');
    expect(kinds).not.toContain('PROPERTY_SELL_BUILDING');
    expect(kindsOn(properties, 'zhitna', mine)).toEqual(
      expect.arrayContaining(['PROPERTY_BUILD', 'PROPERTY_SELL_BUILDING']),
    );
  });

  it('still offers a trade when only another colour group has buildings', () => {
    const properties = [row('zhitna'), row('varshavske', { houses: 1 })];
    expect(kindsOn(properties, 'zhitna', mine)).toContain('PROPERTY_TRANSFER');
  });

  it('offers no trade on a tile the acting wallet owns but the viewer does not control', () => {
    expect(kindsOn([row('zhitna')], 'zhitna', { controlled: [], actor: 'a' })).toEqual([]);
  });
});
