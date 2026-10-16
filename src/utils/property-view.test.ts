import { describe, expect, it } from 'vitest';
import { buildBoardSnapshot, getBoardPreset } from '../../shared/board';
import type { GameProperty } from '../../shared/types/monopoly';
import { cardsOwnedBy, cardsValue, groupProgress, tileRent, tileViews } from './property-view';

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
