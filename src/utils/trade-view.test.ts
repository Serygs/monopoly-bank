import { describe, expect, it } from 'vitest';
import type { BoardSnapshot } from '../../shared/board';
import { buildGameSettings } from '../../shared/domain/game-rules';
import type { GameProperty } from '../../shared/types/monopoly';
import { tileViews, type TileView } from './property-view';
import { tradeOutcome } from './trade-view';

const board = buildGameSettings(15_000_000, 'monopoly-ru-2012').board as BoardSnapshot;

const view = (tileId: string, mortgaged = false): TileView => {
  const registry: GameProperty[] = [
    { gameId: 'g', tileId, ownerPlayerId: 'a', mortgaged, houses: 0 },
  ];
  const found = tileViews(board, registry).find((item) => item.tile.id === tileId);
  if (found === undefined) throw new Error(tileId);
  return found;
};

describe('tradeOutcome', () => {
  it('is zero for a swap of unmortgaged tiles with no cash', () => {
    expect(tradeOutcome(board, [view('zhitna')], [view('nagatinska')], 0, 0)).toEqual({
      proposerFee: 0,
      counterpartyFee: 0,
      proposerDelta: 0,
      counterpartyDelta: 0,
    });
  });

  it('moves cash from the proposer to the counterparty and back', () => {
    const paying = tradeOutcome(board, [view('zhitna')], [], 500_000, 0);
    expect(paying.proposerDelta).toBe(-500_000);
    expect(paying.counterpartyDelta).toBe(500_000);
    const receiving = tradeOutcome(board, [], [view('zhitna')], 0, 300_000);
    expect(receiving.proposerDelta).toBe(300_000);
    expect(receiving.counterpartyDelta).toBe(-300_000);
  });

  it('charges each side the fee for the mortgaged tiles it receives, not the ones it gives away', () => {
    const outcome = tradeOutcome(
      board,
      [view('zhitna', true)],
      [view('nagatinska', true), view('varshavske', true), view('ogarova')],
      100_000,
      40_000,
    );
    expect(outcome.counterpartyFee).toBe(30_000);
    expect(outcome.proposerFee).toBe(30_000 + 50_000);
    expect(outcome.proposerDelta).toBe(40_000 - 100_000 - outcome.proposerFee);
    expect(outcome.counterpartyDelta).toBe(100_000 - 40_000 - outcome.counterpartyFee);
  });

  it('matches the fee the domain charges, tile by tile', () => {
    const outcome = tradeOutcome(board, [view('arbat', true)], [], 0, 0);
    expect(outcome.counterpartyFee).toBe(200_000);
    expect(outcome.counterpartyDelta).toBe(-200_000);
    expect(outcome.proposerDelta).toBe(0);
  });

  it('leaves the fee out for a mortgaged tile that nobody receives', () => {
    const outcome = tradeOutcome(board, [], [], 10, 0);
    expect(outcome.proposerFee).toBe(0);
    expect(outcome.counterpartyFee).toBe(0);
  });
});
