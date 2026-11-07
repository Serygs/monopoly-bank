import { describe, expect, it } from 'vitest';
import { buildBoardSnapshot, getBoardPreset } from '../../../shared/board';
import { sellRefund } from '../../../shared/domain/property';
import type { GameProperty } from '../../../shared/types/monopoly';
import { tileViews } from '../../utils/property-view';
import { emptyRaisePlan, raiseRequests, raiseSummary, raiseTotals } from './banking-raise-plan';

const board = buildBoardSnapshot(getBoardPreset('monopoly-ru-2012'), 100_000);
const mortgageOf = (id: string) => board.tiles.find((tile) => tile.id === id)!.mortgage;
const refund = sellRefund(board, 'zhitna');

const row = (tileId: string, houses = 0, over: Partial<GameProperty> = {}): GameProperty => ({
  gameId: 'g1',
  tileId,
  ownerPlayerId: 'p1',
  mortgaged: false,
  houses,
  ...over,
});
const views = (...rows: GameProperty[]) => tileViews(board, rows);
const ids = (list: readonly { tile: { id: string } }[]) => list.map((view) => view.tile.id);

describe('raiseSummary', () => {
  it('offers only what can be mortgaged now, and counts everything for the maximum', () => {
    const summary = raiseSummary(
      board,
      views(row('zhitna', 2), row('nagatinska', 1), row('riga_rail')),
      'p1',
      emptyRaisePlan,
    );
    expect(ids(summary.mortgageable)).toEqual(['riga_rail']);
    expect(summary.gain).toBe(0);
    expect(summary.maxGain).toBe(
      3 * refund + mortgageOf('zhitna') + mortgageOf('nagatinska') + mortgageOf('riga_rail'),
    );
  });

  it('leaves out other players, mortgaged tiles and their buildings', () => {
    const summary = raiseSummary(
      board,
      views(
        row('riga_rail', 0, { mortgaged: true }),
        row('zhitna', 1, { ownerPlayerId: 'p2' }),
        row('nagatinska', 1, { ownerPlayerId: 'p2' }),
      ),
      'p1',
      emptyRaisePlan,
    );
    expect(summary.groups).toEqual([]);
    expect(summary.mortgageable).toEqual([]);
    expect(summary.maxGain).toBe(0);
  });

  it('adds a tile to the mortgage list once every building of its group is planned for sale', () => {
    const tiles = views(row('zhitna', 1), row('nagatinska', 1));
    const partly = raiseSummary(board, tiles, 'p1', { levels: { zhitna: 0 }, mortgageIds: [] });
    expect(partly.mortgageable).toEqual([]);
    expect(partly.gain).toBe(refund);
    const fully = raiseSummary(board, tiles, 'p1', {
      levels: { zhitna: 0, nagatinska: 0 },
      mortgageIds: ['zhitna'],
    });
    expect(ids(fully.mortgageable)).toEqual(['zhitna', 'nagatinska']);
    expect(fully.gain).toBe(2 * refund + mortgageOf('zhitna'));
  });

  it('drops a chosen tile when its group gets a building back', () => {
    const summary = raiseSummary(board, views(row('zhitna', 1), row('nagatinska', 1)), 'p1', {
      levels: { zhitna: 0, nagatinska: 1 },
      mortgageIds: ['zhitna'],
    });
    expect(summary.mortgages).toEqual([]);
    expect(summary.gain).toBe(refund);
  });

  it('drops a chosen tile that is already mortgaged, so a retry sends only the rest', () => {
    const summary = raiseSummary(
      board,
      views(row('riga_rail', 0, { mortgaged: true }), row('zhitna'), row('nagatinska')),
      'p1',
      { levels: {}, mortgageIds: ['riga_rail', 'zhitna'] },
    );
    expect(ids(summary.mortgages)).toEqual(['zhitna']);
  });

  it('marks uneven selling invalid but keeps the total following the steppers', () => {
    const summary = raiseSummary(board, views(row('zhitna', 2), row('nagatinska', 2)), 'p1', {
      levels: { zhitna: 0 },
      mortgageIds: [],
    });
    expect(summary.invalid).toBe(true);
    expect(summary.gain).toBe(2 * refund);
  });

  it('is not invalid when nothing is chosen', () => {
    const summary = raiseSummary(
      board,
      views(row('zhitna', 1), row('nagatinska', 1)),
      'p1',
      emptyRaisePlan,
    );
    expect(summary.invalid).toBe(false);
  });
});

describe('raiseRequests', () => {
  it('sends one sale per group, then one mortgage per tile', () => {
    const tiles = views(
      row('zhitna', 1),
      row('nagatinska', 1),
      row('varshavske', 1),
      row('riga_rail'),
      ...board.tiles
        .filter((tile) => tile.group === 'lightblue' && tile.id !== 'varshavske')
        .map((tile) => row(tile.id, 1)),
    );
    const summary = raiseSummary(board, tiles, 'p1', {
      levels: { zhitna: 0, nagatinska: 0, varshavske: 0 },
      mortgageIds: ['riga_rail', 'zhitna'],
    });
    expect(raiseRequests('p1', summary)).toEqual([
      {
        type: 'PROPERTY_SELL_BUILDING',
        playerId: 'p1',
        targets: { zhitna: 0, nagatinska: 0 },
      },
      { type: 'PROPERTY_SELL_BUILDING', playerId: 'p1', targets: { varshavske: 0 } },
      { type: 'MORTGAGE', playerId: 'p1', tileId: 'zhitna' },
      { type: 'MORTGAGE', playerId: 'p1', tileId: 'riga_rail' },
    ]);
  });

  it('sends nothing for an unchanged plan', () => {
    const summary = raiseSummary(board, views(row('zhitna', 1), row('nagatinska', 1)), 'p1', {
      levels: { zhitna: 1 },
      mortgageIds: [],
    });
    expect(raiseRequests('p1', summary)).toEqual([]);
  });
});

describe('raiseTotals', () => {
  it('shows what is left, and a negative remainder while the payment is not covered', () => {
    expect(raiseTotals(100, 400, 150, 1000)).toEqual({
      payment: 500,
      afterSelected: 250,
      left: -250,
      afterAll: 1100,
      leftAfterAll: 600,
    });
  });
});
