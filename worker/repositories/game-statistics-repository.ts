import type { ActivityCursor, ActivityPage, LedgerStatistics } from '../../shared/contracts/api.js';
import { mapPaymentRequest, type PaymentRequestRow } from './payment-request-repository.js';
import { D1TradeRequestRepository } from './trade-request-repository.js';
import {
  calculateBalanceSeries,
  calculateGameAwards,
  type LedgerEntry,
} from '../../shared/domain/game-awards.js';
import type { Game, Player, Transaction, TransactionType } from '../../shared/types/monopoly.js';
import { D1TransactionRepository } from './transaction-repository.js';

export interface GameStatisticsRepository {
  activity(
    gameId: string,
    scope: 'ALL' | 'MINE',
    playerIds: readonly string[],
    cursor: ActivityCursor | null,
    limit: number,
  ): Promise<ActivityPage>;
  pending(
    gameId: string,
    playerIds: readonly string[],
    cursor: ActivityCursor | null,
    limit: number,
  ): Promise<ActivityPage>;
  calculate(game: Game, players: readonly Player[]): Promise<LedgerStatistics>;
  getFinalSnapshot(
    gameId: string,
  ): Promise<{ winnerPlayerIds: string[]; summary: LedgerStatistics } | null>;
  saveFinalSnapshot(
    gameId: string,
    winnerPlayerIds: readonly string[],
    summary: LedgerStatistics,
  ): Promise<void>;
}

export class D1GameStatisticsRepository implements GameStatisticsRepository {
  private readonly database: D1Database;
  constructor(database: D1Database) {
    this.database = database;
  }

  async activity(
    gameId: string,
    scope: 'ALL' | 'MINE',
    playerIds: readonly string[],
    cursor: ActivityCursor | null,
    limit: number,
  ): Promise<ActivityPage> {
    if (scope === 'MINE' && playerIds.length === 0)
      return { transactions: [], paymentRequests: [], nextCursor: null };
    const cursorClause =
      cursor === null ? '' : 'AND (created_at < ? OR (created_at = ? AND id < ?))';
    const membershipClause =
      scope === 'MINE'
        ? `AND EXISTS (SELECT 1 FROM transaction_participants mine WHERE mine.transaction_id = transactions.id AND mine.player_id IN (${playerIds.map(() => '?').join(', ')}))`
        : '';
    const values: (string | number)[] = [gameId, ...(scope === 'MINE' ? playerIds : [])];
    if (cursor !== null) values.push(cursor.createdAt, cursor.createdAt, cursor.id);
    values.push(limit + 1);
    const rows = await this.database
      .prepare(
        `SELECT id FROM transactions WHERE game_id = ? ${membershipClause} ${cursorClause} ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .bind(...values)
      .all<{ id: string }>();
    const ids = rows.results.slice(0, limit).map((row) => row.id);
    const transactions = await Promise.all(
      ids.map((id) => new D1TransactionRepository(this.database).getById(gameId, id)),
    ).then((items) => items.filter((item): item is Transaction => item !== null));
    const tail = rows.results[limit - 1];
    return {
      transactions,
      paymentRequests: [],
      nextCursor:
        rows.results.length > limit && tail !== undefined
          ? { createdAt: transactions[transactions.length - 1]?.createdAt ?? '', id: tail.id }
          : null,
    };
  }

  async pending(
    gameId: string,
    playerIds: readonly string[],
    cursor: ActivityCursor | null,
    limit: number,
  ): Promise<ActivityPage> {
    if (playerIds.length === 0) return { transactions: [], paymentRequests: [], nextCursor: null };
    await this.database
      .prepare(
        "UPDATE payment_requests SET state = 'EXPIRED', resolved_at = CURRENT_TIMESTAMP WHERE game_id = ? AND state = 'PENDING' AND expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
      )
      .bind(gameId)
      .run();
    const cursorClause =
      cursor === null ? '' : 'AND (created_at < ? OR (created_at = ? AND id < ?))';
    const values: (string | number)[] = [gameId, ...playerIds];
    if (cursor !== null) values.push(cursor.createdAt, cursor.createdAt, cursor.id);
    values.push(limit + 1);
    const rows = await this.database
      .prepare(
        `SELECT * FROM payment_requests WHERE game_id = ? AND state = 'PENDING' AND (creator_player_id IN (${playerIds.map(() => '?').join(', ')}) OR approver_player_id IN (${playerIds.map(() => '?').join(', ')})) ${cursorClause} ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .bind(gameId, ...playerIds, ...values.slice(1))
      .all<PaymentRequestRow>();
    const requests = rows.results.slice(0, limit).map(mapPaymentRequest);
    const tail = requests[requests.length - 1];
    return {
      transactions: [],
      paymentRequests: requests,
      // Pending trades are few and short-lived, so they ride along on the first page only.
      ...(cursor === null
        ? {
            tradeRequests: await new D1TradeRequestRepository(this.database).listPendingForPlayers(
              gameId,
              playerIds,
            ),
          }
        : {}),
      nextCursor:
        rows.results.length > limit && tail !== undefined
          ? { createdAt: tail.createdAt, id: tail.id }
          : null,
    };
  }

  async calculate(game: Game, players: readonly Player[]): Promise<LedgerStatistics> {
    // TO_JACKPOT counts as money the player sent and JACKPOT_PAYOUT as money received; neither is
    // paid to / received from the bank, nor player-to-player, so the totals below list them by type.
    const totals = await this.database
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(total_amount), 0) AS moved, COALESCE(MAX(total_amount), 0) AS largest, COALESCE(SUM(CASE WHEN type IN ('PLAYER_TO_PLAYER','PAY_RENT','BANKRUPTCY_TRANSFER','PROPERTY_TRANSFER') THEN total_amount ELSE 0 END), 0) AS p2p, COALESCE(SUM(CASE WHEN type IN ('PLAYER_TO_BANK','MORTGAGE_REDEMPTION','AUCTION_PAYMENT','PROPERTY_PURCHASE','PROPERTY_BUILD') THEN total_amount ELSE 0 END), 0) AS paid_bank, COALESCE(SUM(CASE WHEN type IN ('BANK_TO_PLAYER','PASS_GO','MORTGAGE','PROPERTY_SELL_BUILDING') THEN total_amount ELSE 0 END), 0) AS received_bank FROM transactions WHERE game_id = ? AND ${countedTransaction('transactions')}`,
      )
      .bind(game.id)
      .first<TotalsRow>();
    const metrics = await this.database
      .prepare(
        `SELECT p.id AS player_id, COALESCE(SUM(CASE WHEN tp.balance_delta < 0 AND t.type NOT IN ('LOAN_ISSUE','LOAN_REPAYMENT') THEN -tp.balance_delta ELSE 0 END),0) AS sent, COALESCE(SUM(CASE WHEN tp.balance_delta > 0 AND t.type NOT IN ('LOAN_ISSUE','LOAN_REPAYMENT') THEN tp.balance_delta ELSE 0 END),0) AS received, COUNT(tp.transaction_id) AS transaction_count, COALESCE(SUM(CASE WHEN t.type = 'PASS_GO' THEN 1 ELSE 0 END),0) AS pass_go_count FROM players p LEFT JOIN transaction_participants tp ON tp.game_id = p.game_id AND tp.player_id = p.id AND tp.transaction_id IN (SELECT counted.id FROM transactions counted WHERE counted.game_id = p.game_id AND ${countedTransaction('counted')}) LEFT JOIN transactions t ON t.id = tp.transaction_id WHERE p.game_id = ? GROUP BY p.id`,
      )
      .bind(game.id)
      .all<PlayerMetricRow>();
    const ledger = await this.database
      .prepare(
        `SELECT t.id AS transaction_id, t.type, t.total_amount, t.comment, tp.player_id, tp.balance_delta FROM transactions t JOIN transaction_participants tp ON tp.transaction_id = t.id AND tp.game_id = t.game_id WHERE t.game_id = ? AND ${countedTransaction('t')} ORDER BY t.created_at, t.rowid, tp.rowid`,
      )
      .bind(game.id)
      .all<LedgerRow>();
    const entries: LedgerEntry[] = ledger.results.map((row) => ({
      transactionId: row.transaction_id,
      type: row.type,
      totalAmount: row.total_amount,
      comment: row.comment,
      playerId: row.player_id,
      balanceDelta: row.balance_delta,
    }));
    const metricById = new Map(metrics.results.map((row) => [row.player_id, row]));
    const ordered = players.map((player) => ({
      player,
      row: metricById.get(player.id) ?? emptyMetric(player.id),
    }));
    const bySent = [...ordered].sort(
      (a, b) => b.row.sent - a.row.sent || a.player.id.localeCompare(b.player.id),
    );
    const cashLeaderboard = [...ordered]
      .sort((a, b) => b.player.balance - a.player.balance || a.player.id.localeCompare(b.player.id))
      .map(({ player, row }) => ({
        player,
        sent: row.sent,
        received: row.received,
        passGoCount: row.pass_go_count,
        transactionCount: row.transaction_count,
      }));
    const durationMs =
      game.startedAt === null || game.startedAt === undefined
        ? 0
        : Math.max(
            0,
            new Date(game.finishedAt ?? new Date().toISOString()).getTime() -
              new Date(game.startedAt).getTime(),
          );
    const value = totals ?? {
      count: 0,
      moved: 0,
      largest: 0,
      p2p: 0,
      paid_bank: 0,
      received_bank: 0,
    };
    return {
      durationMs,
      totalTransactions: value.count,
      totalMoneyTransferred: value.moved,
      largestSinglePayment: value.largest,
      richestActivePlayer:
        cashLeaderboard.find((entry) => entry.player.status !== 'BANKRUPT')?.player ?? null,
      lowestActiveBalance:
        cashLeaderboard.filter((entry) => entry.player.status !== 'BANKRUPT').at(-1)?.player
          .balance ?? null,
      players: ordered.map(({ player, row }) => ({
        player,
        totalReceived: row.received,
        totalPaid: row.sent,
        passGoCount: row.pass_go_count,
        transactionCount: row.transaction_count,
      })),
      playerToPlayerTotal: value.p2p,
      paidToBank: value.paid_bank,
      receivedFromBank: value.received_bank,
      largestTransaction: value.largest,
      biggestSenderId: bySent[0]?.player.id ?? null,
      leastSenderId: bySent.at(-1)?.player.id ?? null,
      biggestPayerRecipient: null,
      cashLeaderboard,
      awards: calculateGameAwards(entries),
      balanceSeries: calculateBalanceSeries(
        entries,
        players.map((player) => player.id),
        game.startingBalance,
      ),
    };
  }

  async getFinalSnapshot(
    gameId: string,
  ): Promise<{ winnerPlayerIds: string[]; summary: LedgerStatistics } | null> {
    const row = await this.database
      .prepare(
        'SELECT winner_player_ids_json, summary_json FROM game_final_snapshots WHERE game_id = ?',
      )
      .bind(gameId)
      .first<{ winner_player_ids_json: string; summary_json: string }>();
    return row === null
      ? null
      : {
          winnerPlayerIds: JSON.parse(row.winner_player_ids_json) as string[],
          summary: JSON.parse(row.summary_json) as LedgerStatistics,
        };
  }
  async saveFinalSnapshot(
    gameId: string,
    winnerPlayerIds: readonly string[],
    summary: LedgerStatistics,
  ): Promise<void> {
    await this.database
      .prepare(
        'INSERT INTO game_final_snapshots (game_id, winner_player_ids_json, summary_json) VALUES (?, ?, ?) ON CONFLICT(game_id) DO NOTHING',
      )
      .bind(gameId, JSON.stringify(winnerPlayerIds), JSON.stringify(summary))
      .run();
  }
}

interface TotalsRow {
  count: number;
  moved: number;
  largest: number;
  p2p: number;
  paid_bank: number;
  received_bank: number;
}
interface LedgerRow {
  transaction_id: string;
  type: TransactionType;
  total_amount: number;
  comment: string | null;
  player_id: string;
  balance_delta: number;
}
interface PlayerMetricRow {
  player_id: string;
  sent: number;
  received: number;
  transaction_count: number;
  pass_go_count: number;
}
function emptyMetric(player_id: string): PlayerMetricRow {
  return { player_id, sent: 0, received: 0, transaction_count: 0, pass_go_count: 0 };
}
/**
 * Statistics count what the game actually moved: a reversed transaction and the reversal that
 * undid it cancel out, so neither is counted. Both stay in the activity history.
 */
function countedTransaction(alias: string): string {
  return `${alias}.type <> 'REVERSAL' AND NOT EXISTS (SELECT 1 FROM transactions reversal WHERE reversal.reverses_transaction_id = ${alias}.id)`;
}
