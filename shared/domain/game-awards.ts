import type { BalanceSeries, GameAwards, StatisticsAward } from '../contracts/api.js';
import type { TransactionType } from '../types/monopoly.js';

/** One participant row of a counted transaction, in chronological order. */
export interface LedgerEntry {
  transactionId: string;
  type: TransactionType;
  totalAmount: number;
  comment: string | null;
  playerId: string;
  balanceDelta: number;
}

/** The balance series keeps at most this many points per player, first and last included. */
export const MAX_SERIES_POINTS = 61;

interface Grouped {
  id: string;
  type: TransactionType;
  totalAmount: number;
  comment: string | null;
  deltas: Array<{ playerId: string; delta: number }>;
}

function group(entries: readonly LedgerEntry[]): Grouped[] {
  const grouped = new Map<string, Grouped>();
  for (const entry of entries) {
    const current = grouped.get(entry.transactionId) ?? {
      id: entry.transactionId,
      type: entry.type,
      totalAmount: entry.totalAmount,
      comment: entry.comment,
      deltas: [],
    };
    current.deltas.push({ playerId: entry.playerId, delta: entry.balanceDelta });
    grouped.set(entry.transactionId, current);
  }
  return [...grouped.values()];
}

function top(
  amounts: Map<string, number>,
  better: (candidate: number, best: number) => boolean = (a, b) => a > b,
): StatisticsAward | null {
  let best: StatisticsAward | null = null;
  for (const [playerId, amount] of [...amounts].sort(([a], [b]) => a.localeCompare(b)))
    if (amount > 0 && (best === null || better(amount, best.amount))) best = { playerId, amount };
  return best;
}

function add(map: Map<string, number>, key: string, amount: number) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

/**
 * Award cards from the ledger rows that statistics count (a reversed transaction and its reversal
 * are already left out). Rent is approximated by player-to-player payments, since rent is not
 * enforced. Nothing is stored: every figure is derived from the transactions.
 */
export function calculateGameAwards(entries: readonly LedgerEntry[]): GameAwards {
  const rentPaid = new Map<string, number>();
  const rentCollected = new Map<string, number>();
  let biggestOperation: GameAwards['biggestOperation'] = null;
  let bestAuctionDeal: StatisticsAward | null = null;
  let biggestLoan: StatisticsAward | null = null;
  for (const transaction of group(entries)) {
    const payer = transaction.deltas.find((item) => item.delta < 0) ?? null;
    const receiver = transaction.deltas.find((item) => item.delta > 0) ?? null;
    if (
      transaction.type !== 'LOAN_ISSUE' &&
      transaction.type !== 'LOAN_REPAYMENT' &&
      // A gift or straight swap moves no money, so it is never the biggest operation.
      transaction.totalAmount > 0 &&
      (biggestOperation === null || transaction.totalAmount > biggestOperation.amount)
    )
      biggestOperation = {
        type: transaction.type,
        amount: transaction.totalAmount,
        playerId: (payer ?? receiver)?.playerId ?? null,
      };
    if (transaction.type === 'PLAYER_TO_PLAYER' || transaction.type === 'PAY_RENT') {
      if (payer !== null) add(rentPaid, payer.playerId, transaction.totalAmount);
      if (receiver !== null) add(rentCollected, receiver.playerId, transaction.totalAmount);
    }
    if (transaction.type === 'AUCTION_PAYMENT' && payer !== null) {
      // The cheapest lot won is the best deal; without ownership the price is all that is known.
      if (bestAuctionDeal === null || transaction.totalAmount < bestAuctionDeal.amount)
        bestAuctionDeal = {
          playerId: payer.playerId,
          amount: transaction.totalAmount,
          label: transaction.comment,
        };
    }
    if (
      transaction.type === 'LOAN_ISSUE' &&
      receiver !== null &&
      (biggestLoan === null || transaction.totalAmount > biggestLoan.amount)
    )
      biggestLoan = { playerId: receiver.playerId, amount: transaction.totalAmount };
  }
  return {
    biggestOperation,
    rentPaid: top(rentPaid),
    rentCollected: top(rentCollected),
    bestAuctionDeal,
    biggestLoan,
  };
}

/** Every player's balance after each counted transaction, thinned to `MAX_SERIES_POINTS`. */
export function calculateBalanceSeries(
  entries: readonly LedgerEntry[],
  playerIds: readonly string[],
  startingBalance: number,
): BalanceSeries {
  const running = new Map(playerIds.map((id) => [id, startingBalance]));
  const full = new Map(playerIds.map((id) => [id, [startingBalance]]));
  const transactions = group(entries);
  for (const transaction of transactions) {
    for (const { playerId, delta } of transaction.deltas)
      if (running.has(playerId)) running.set(playerId, (running.get(playerId) ?? 0) + delta);
    for (const id of playerIds) full.get(id)?.push(running.get(id) ?? startingBalance);
  }
  const steps = transactions.length;
  const keep =
    steps + 1 <= MAX_SERIES_POINTS
      ? Array.from({ length: steps + 1 }, (_, index) => index)
      : Array.from({ length: MAX_SERIES_POINTS }, (_, index) =>
          Math.round((index * steps) / (MAX_SERIES_POINTS - 1)),
        );
  return {
    steps,
    players: playerIds.map((playerId) => ({
      playerId,
      balances: keep.map((index) => full.get(playerId)?.[index] ?? startingBalance),
    })),
  };
}
