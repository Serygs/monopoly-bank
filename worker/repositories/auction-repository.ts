import { AUCTION_RESULT_VISIBLE_MS } from '../../shared/domain/auction.js';
import type { Auction, AuctionState } from '../../shared/types/monopoly.js';
import { DatabaseError } from '../services/errors.js';

interface AuctionRow {
  id: string;
  game_id: string;
  lot_name: string;
  initiator_player_id: string;
  state: AuctionState;
  current_bid: number;
  current_bidder_id: string | null;
  version: number;
  started_at: string;
  ends_at: string;
  settled_transaction_id: string | null;
}

export interface CreateAuctionInput {
  id: string;
  gameId: string;
  lotName: string;
  initiatorPlayerId: string;
  startedAt: string;
  endsAt: string;
}

export interface PlaceBidInput {
  gameId: string;
  auctionId: string;
  expectedVersion: number;
  bid: number;
  bidderPlayerId: string;
  /** ISO time; the bid is refused at or after the end. */
  nowIso: string;
}

export interface AuctionRepository {
  /** The running auction of a game, if any. */
  getActive(gameId: string): Promise<Auction | null>;
  getById(gameId: string, auctionId: string): Promise<Auction | null>;
  /** The active auction, else the one that closed in the last two minutes (by its end time). */
  getCurrent(gameId: string, nowMs: number): Promise<Auction | null>;
  create(input: CreateAuctionInput): Promise<void>;
  /**
   * Compare-and-set on the version: false when the auction changed, closed or ended meanwhile, or
   * the bidder can no longer cover the bid (their balance, less their pending payment requests, is part of the same statement).
   */
  placeBid(input: PlaceBidInput): Promise<boolean>;
  /** Closes an ACTIVE auction at the given version without a sale; false if it moved on. */
  closeWithoutSale(gameId: string, auctionId: string, expectedVersion: number): Promise<boolean>;
}

const columns =
  'id, game_id, lot_name, initiator_player_id, state, current_bid, current_bidder_id, version, started_at, ends_at, settled_transaction_id';

export class D1AuctionRepository implements AuctionRepository {
  private readonly database: D1Database;

  constructor(database: D1Database) {
    this.database = database;
  }

  async getActive(gameId: string): Promise<Auction | null> {
    const row = await this.database
      .prepare(`SELECT ${columns} FROM auctions WHERE game_id = ? AND state = 'ACTIVE'`)
      .bind(gameId)
      .first<AuctionRow>();
    return row === null ? null : mapAuction(row);
  }

  async getById(gameId: string, auctionId: string): Promise<Auction | null> {
    const row = await this.database
      .prepare(`SELECT ${columns} FROM auctions WHERE game_id = ? AND id = ?`)
      .bind(gameId, auctionId)
      .first<AuctionRow>();
    return row === null ? null : mapAuction(row);
  }

  async getCurrent(gameId: string, nowMs: number): Promise<Auction | null> {
    const active = await this.getActive(gameId);
    if (active !== null) return active;
    const since = new Date(nowMs - AUCTION_RESULT_VISIBLE_MS).toISOString();
    const row = await this.database
      .prepare(
        `SELECT ${columns} FROM auctions WHERE game_id = ? AND state <> 'ACTIVE' AND ends_at > ?
         ORDER BY ends_at DESC, started_at DESC LIMIT 1`,
      )
      .bind(gameId, since)
      .first<AuctionRow>();
    return row === null ? null : mapAuction(row);
  }

  async create(input: CreateAuctionInput): Promise<void> {
    try {
      await this.database
        .prepare(
          `INSERT INTO auctions (id, game_id, lot_name, initiator_player_id, started_at, ends_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          input.id,
          input.gameId,
          input.lotName,
          input.initiatorPlayerId,
          input.startedAt,
          input.endsAt,
        )
        .run();
    } catch (cause) {
      throw new DatabaseError({ operation: 'createAuction', cause });
    }
  }

  async placeBid(input: PlaceBidInput): Promise<boolean> {
    try {
      const result = await this.database
        .prepare(
          `UPDATE auctions
           SET current_bid = ?1, current_bidder_id = ?2, version = version + 1
           WHERE id = ?3 AND game_id = ?4 AND state = 'ACTIVE' AND version = ?5 AND ends_at > ?6
             AND current_bid < ?1
             AND (current_bidder_id IS NULL OR current_bidder_id <> ?2)
             AND (SELECT balance FROM players WHERE id = ?2 AND game_id = ?4 AND status = 'ACTIVE')
                 - COALESCE((SELECT SUM(amount) FROM payment_requests
                             WHERE game_id = ?4 AND payer_player_id = ?2 AND state = 'PENDING'
                               AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), 0) >= ?1`,
        )
        .bind(
          input.bid,
          input.bidderPlayerId,
          input.auctionId,
          input.gameId,
          input.expectedVersion,
          input.nowIso,
        )
        .run();
      return (result.meta?.changes ?? 0) === 1;
    } catch (cause) {
      throw new DatabaseError({ operation: 'placeBid', cause });
    }
  }

  async closeWithoutSale(
    gameId: string,
    auctionId: string,
    expectedVersion: number,
  ): Promise<boolean> {
    try {
      const result = await this.database
        .prepare(
          `UPDATE auctions SET state = 'NO_SALE', version = version + 1
           WHERE id = ? AND game_id = ? AND state = 'ACTIVE' AND version = ?`,
        )
        .bind(auctionId, gameId, expectedVersion)
        .run();
      return (result.meta?.changes ?? 0) === 1;
    } catch (cause) {
      throw new DatabaseError({ operation: 'closeAuctionWithoutSale', cause });
    }
  }
}

function mapAuction(row: AuctionRow): Auction {
  return {
    id: row.id,
    gameId: row.game_id,
    lotName: row.lot_name,
    initiatorPlayerId: row.initiator_player_id,
    state: row.state,
    currentBid: row.current_bid,
    currentBidderId: row.current_bidder_id,
    version: row.version,
    startedAt: row.started_at,
    endsAt: row.ends_at,
    serverTime: new Date().toISOString(),
    settledTransactionId: row.settled_transaction_id,
  };
}
