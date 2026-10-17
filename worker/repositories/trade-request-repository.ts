import type { PaymentRequestState, TradeRequest } from '../../shared/contracts/api.js';

interface TradeRequestRow {
  id: string;
  game_id: string;
  proposer_player_id: string;
  counterparty_player_id: string;
  give_tile_ids: string;
  take_tile_ids: string;
  cash_give: number;
  cash_take: number;
  state: PaymentRequestState;
  expires_at: string;
  created_at: string;
  resolved_at: string | null;
  transaction_id: string | null;
}

const COLUMNS =
  'id, game_id, proposer_player_id, counterparty_player_id, give_tile_ids, take_tile_ids, cash_give, cash_take, state, expires_at, created_at, resolved_at, transaction_id';

export type NewTradeRequest = Omit<TradeRequest, 'createdAt' | 'resolvedAt' | 'transactionId'>;

/**
 * Trade requests are workflow state only. Accepting one writes the ledger and the registry through
 * the banking operation repository, in the same batch that flips the request to ACCEPTED.
 */
export interface TradeRequestRepository {
  /** Idempotent by id: a second insert with the same id is ignored. */
  create(input: NewTradeRequest): Promise<void>;
  getById(gameId: string, id: string): Promise<TradeRequest | null>;
  /** PENDING requests where any of the wallets is the proposer (waiting) or counterparty (inbox). */
  listPendingForPlayers(gameId: string, playerIds: readonly string[]): Promise<TradeRequest[]>;
  /** Marks every PENDING request of the game whose time is up as EXPIRED. */
  expirePending(gameId: string): Promise<void>;
  /** Only a PENDING request can be resolved; false when it no longer was. */
  resolve(
    requestId: string,
    state: Extract<PaymentRequestState, 'DECLINED' | 'CANCELLED'>,
  ): Promise<boolean>;
}

export class D1TradeRequestRepository implements TradeRequestRepository {
  private readonly database: D1Database;
  constructor(database: D1Database) {
    this.database = database;
  }

  async create(input: NewTradeRequest): Promise<void> {
    await this.database
      .prepare(
        `INSERT INTO trade_requests (id, game_id, proposer_player_id, counterparty_player_id, give_tile_ids, take_tile_ids, cash_give, cash_take, state, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
      )
      .bind(
        input.id,
        input.gameId,
        input.proposerPlayerId,
        input.counterpartyPlayerId,
        JSON.stringify(input.giveTileIds),
        JSON.stringify(input.takeTileIds),
        input.cashGive,
        input.cashTake,
        input.state,
        input.expiresAt,
      )
      .run();
  }

  async getById(gameId: string, id: string): Promise<TradeRequest | null> {
    const row = await this.database
      .prepare(`SELECT ${COLUMNS} FROM trade_requests WHERE game_id = ? AND id = ?`)
      .bind(gameId, id)
      .first<TradeRequestRow>();
    return row === null ? null : mapTradeRequest(row);
  }

  async listPendingForPlayers(
    gameId: string,
    playerIds: readonly string[],
  ): Promise<TradeRequest[]> {
    if (playerIds.length === 0) return [];
    await this.expirePending(gameId);
    const placeholders = playerIds.map(() => '?').join(', ');
    const result = await this.database
      .prepare(
        `SELECT ${COLUMNS} FROM trade_requests WHERE game_id = ? AND state = 'PENDING'
        AND (counterparty_player_id IN (${placeholders}) OR proposer_player_id IN (${placeholders}))
      ORDER BY created_at ASC, id ASC`,
      )
      .bind(gameId, ...playerIds, ...playerIds)
      .all<TradeRequestRow>();
    return result.results.map(mapTradeRequest);
  }

  async expirePending(gameId: string): Promise<void> {
    await this.database
      .prepare(
        `UPDATE trade_requests SET state = 'EXPIRED', resolved_at = CURRENT_TIMESTAMP
      WHERE game_id = ? AND state = 'PENDING' AND expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      )
      .bind(gameId)
      .run();
  }

  async resolve(
    requestId: string,
    state: Extract<PaymentRequestState, 'DECLINED' | 'CANCELLED'>,
  ): Promise<boolean> {
    const result = await this.database
      .prepare(
        `UPDATE trade_requests SET state = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ? AND state = 'PENDING'`,
      )
      .bind(state, requestId)
      .run();
    return result.meta.changes === 1;
  }
}

export function mapTradeRequest(row: TradeRequestRow): TradeRequest {
  return {
    id: row.id,
    gameId: row.game_id,
    proposerPlayerId: row.proposer_player_id,
    counterpartyPlayerId: row.counterparty_player_id,
    giveTileIds: JSON.parse(row.give_tile_ids) as string[],
    takeTileIds: JSON.parse(row.take_tile_ids) as string[],
    cashGive: row.cash_give,
    cashTake: row.cash_take,
    state: row.state,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    transactionId: row.transaction_id,
  };
}
