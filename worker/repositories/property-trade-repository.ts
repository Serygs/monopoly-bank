import type { MortgageResolution, PropertyTrade, PropertyTradeItem, PropertyTradeState } from '../../shared/contracts/api.js';
import { DatabaseError } from '../services/errors.js';

interface TradeRow {
  id: string;
  game_id: string;
  proposer_player_id: string;
  responder_player_id: string;
  cash_from_proposer: number;
  cash_from_responder: number;
  state: PropertyTradeState;
  expires_at: string;
  created_at: string;
  resolved_at: string | null;
  transaction_id: string | null;
  item_board_space_id: string | null;
  item_from_player_id: string | null;
  item_mortgage_resolution: MortgageResolution | null;
}

export interface CreatePropertyTradeInput {
  trade: Omit<PropertyTrade, 'createdAt' | 'resolvedAt' | 'transactionId' | 'items'>;
  items: readonly PropertyTradeItem[];
  boardId: string;
}

/**
 * The offer ledger. Acceptance is not written here: the settling `UPDATE` of
 * `property_trades` rides in `D1BankingOperationRepository.persist`, in the same
 * batch as the deeds, balances and transaction it settles.
 */
export interface PropertyTradeRepository {
  create(input: CreatePropertyTradeInput): Promise<void>;
  getById(gameId: string, tradeId: string): Promise<PropertyTrade | null>;
  listByGameId(gameId: string): Promise<PropertyTrade[]>;
  expirePending(gameId: string): Promise<void>;
  resolve(gameId: string, tradeId: string, state: Extract<PropertyTradeState, 'DECLINED' | 'CANCELLED'>): Promise<boolean>;
}

const tradeSelect = `SELECT property_trades.id, property_trades.game_id, property_trades.proposer_player_id, property_trades.responder_player_id,
  property_trades.cash_from_proposer, property_trades.cash_from_responder, property_trades.state, property_trades.expires_at,
  property_trades.created_at, property_trades.resolved_at, property_trades.transaction_id,
  property_trade_items.board_space_id AS item_board_space_id, property_trade_items.from_player_id AS item_from_player_id, property_trade_items.mortgage_resolution AS item_mortgage_resolution
FROM property_trades
LEFT JOIN property_trade_items ON property_trade_items.trade_id = property_trades.id AND property_trade_items.game_id = property_trades.game_id`;

export class D1PropertyTradeRepository implements PropertyTradeRepository {
  private readonly database: D1Database;

  constructor(database: D1Database) {
    this.database = database;
  }

  async create(input: CreatePropertyTradeInput): Promise<void> {
    const trade = input.trade;
    const tradeStatement = this.database.prepare(
      `INSERT INTO property_trades (id, game_id, proposer_player_id, responder_player_id, cash_from_proposer, cash_from_responder, state, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
    ).bind(trade.id, trade.gameId, trade.proposerPlayerId, trade.responderPlayerId, trade.cashFromProposer, trade.cashFromResponder, trade.state, trade.expiresAt);
    const itemStatements = input.items.map((item) => this.database.prepare(
      `INSERT INTO property_trade_items (trade_id, game_id, board_space_id, board_id, from_player_id, mortgage_resolution)
       VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(trade_id, board_space_id) DO NOTHING`,
    ).bind(trade.id, trade.gameId, item.boardSpaceId, input.boardId, item.fromPlayerId, item.mortgageResolution));
    try {
      await this.database.batch([tradeStatement, ...itemStatements]);
    } catch (cause) {
      throw new DatabaseError({ operation: 'createPropertyTrade', cause });
    }
  }

  async getById(gameId: string, tradeId: string): Promise<PropertyTrade | null> {
    const result = await this.database.prepare(`${tradeSelect} WHERE property_trades.game_id = ? AND property_trades.id = ? ORDER BY property_trade_items.board_space_id ASC`).bind(gameId, tradeId).all<TradeRow>();
    return mapTrades(result.results)[0] ?? null;
  }

  async listByGameId(gameId: string): Promise<PropertyTrade[]> {
    const result = await this.database.prepare(`${tradeSelect} WHERE property_trades.game_id = ? ORDER BY property_trades.created_at DESC, property_trades.id DESC, property_trade_items.board_space_id ASC`).bind(gameId).all<TradeRow>();
    return mapTrades(result.results);
  }

  async expirePending(gameId: string): Promise<void> {
    await this.database.prepare(`UPDATE property_trades SET state = 'EXPIRED', resolved_at = CURRENT_TIMESTAMP
      WHERE game_id = ? AND state = 'PENDING' AND expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`).bind(gameId).run();
  }

  async resolve(gameId: string, tradeId: string, state: Extract<PropertyTradeState, 'DECLINED' | 'CANCELLED'>): Promise<boolean> {
    const result = await this.database.prepare(`UPDATE property_trades SET state = ?, resolved_at = CURRENT_TIMESTAMP WHERE game_id = ? AND id = ? AND state = 'PENDING'`).bind(state, gameId, tradeId).run();
    return result.meta.changes === 1;
  }
}

/** A pending offer past its expiry reads as `EXPIRED` even before the sweep has run, so it can never be accepted late. */
function mapTrades(rows: readonly TradeRow[]): PropertyTrade[] {
  const now = new Date().toISOString();
  const trades = new Map<string, PropertyTrade>();
  for (const row of rows) {
    let trade = trades.get(row.id);
    if (trade === undefined) {
      trade = {
        id: row.id,
        gameId: row.game_id,
        proposerPlayerId: row.proposer_player_id,
        responderPlayerId: row.responder_player_id,
        cashFromProposer: row.cash_from_proposer,
        cashFromResponder: row.cash_from_responder,
        items: [],
        state: row.state === 'PENDING' && row.expires_at <= now ? 'EXPIRED' : row.state,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
        resolvedAt: row.resolved_at,
        transactionId: row.transaction_id,
      };
      trades.set(row.id, trade);
    }
    if (row.item_board_space_id !== null && row.item_from_player_id !== null) {
      trade.items.push({ boardSpaceId: row.item_board_space_id, fromPlayerId: row.item_from_player_id, mortgageResolution: row.item_mortgage_resolution });
    }
  }
  return [...trades.values()];
}
