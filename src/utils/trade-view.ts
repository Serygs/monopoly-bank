import type { BoardSnapshot } from '../../shared/board';
import { mortgageTransferFee } from '../../shared/domain/banking';
import type { TileView } from './property-view';

export interface TradeOutcome {
  /** What each side pays the bank for the mortgaged tiles it receives. */
  proposerFee: number;
  counterpartyFee: number;
  /** The balance change of each side, cash and fee included. */
  proposerDelta: number;
  counterpartyDelta: number;
}

/**
 * What a trade does to the two balances, mirroring `transferProperties`: the proposer gives
 * `giveViews` and `cashGive`, takes `takeViews` and `cashTake`; each side pays the bank 10% of the
 * mortgage value of every mortgaged tile it receives.
 */
export function tradeOutcome(
  board: BoardSnapshot,
  giveViews: readonly TileView[],
  takeViews: readonly TileView[],
  cashGive: number,
  cashTake: number,
): TradeOutcome {
  const fee = (views: readonly TileView[]) =>
    views.reduce(
      (sum, view) => sum + (view.mortgaged ? mortgageTransferFee(board, view.tile.id) : 0),
      0,
    );
  const proposerFee = fee(takeViews);
  const counterpartyFee = fee(giveViews);
  return {
    proposerFee,
    counterpartyFee,
    proposerDelta: cashTake - cashGive - proposerFee,
    counterpartyDelta: cashGive - cashTake - counterpartyFee,
  };
}
