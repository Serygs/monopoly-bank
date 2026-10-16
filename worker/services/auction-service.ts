import type {
  AuctionResponse,
  PlaceBidRequest,
  StartAuctionRequest,
} from '../../shared/contracts/api.js';
import {
  AUCTION_BID_EXTENSION_MS,
  AUCTION_DURATION_MS,
  AuctionAlreadyActiveError,
  AuctionBidStaleError,
  AuctionNotFoundError,
  isAuctionDue,
  planAuctionSettlement,
  validateBid,
} from '../../shared/domain/auction.js';
import {
  InvalidGameStateError,
  PlayerBankruptError,
  PlayerNotFoundError,
} from '../../shared/domain/banking.js';
import { normalizePropertyName } from '../../shared/domain/mortgage.js';
import type { Auction, Game } from '../../shared/types/monopoly.js';
import type { AuctionRepository } from '../repositories/auction-repository.js';
import type { BankingOperationRepository } from '../repositories/banking-operation-repository.js';
import type { GameRepository } from '../repositories/game-repository.js';
import type { PaymentRequestRepository } from '../repositories/payment-request-repository.js';
import type { PlayerRepository } from '../repositories/player-repository.js';
import type { TransactionRepository } from '../repositories/transaction-repository.js';
import {
  DatabaseError,
  PersistenceConsistencyError,
  ResourceNotFoundError,
  RuleDisabledError,
  ValidationError,
} from './errors.js';
import { assertRuleEnabled } from './rule-guard.js';

export interface AuctionService {
  /** The running auction, or the one that closed in the last two minutes. */
  getCurrent(gameId: string): Promise<Auction | null>;
  startAuction(
    gameId: string,
    request: StartAuctionRequest,
    auctionId: string,
  ): Promise<AuctionResponse>;
  placeBid(gameId: string, request: PlaceBidRequest): Promise<AuctionResponse>;
  /**
   * Closes the auction once it is due: a sale (the AUCTION_PAYMENT, the balance and the auction in
   * one guarded batch) or no sale. Idempotent: whoever closed it, the same closed result comes back.
   * `null` when it is not due yet; a missing game or auction is a not-found error.
   */
  settleDue(gameId: string, auctionId: string): Promise<AuctionResponse | null>;
}

export interface AuctionServiceDependencies {
  games: GameRepository;
  players: PlayerRepository;
  transactions: TransactionRepository;
  operations: BankingOperationRepository;
  paymentRequests: PaymentRequestRepository;
  auctions: AuctionRepository;
  /** Milliseconds since the epoch; injectable so tests can move the clock. */
  now?: () => number;
  /** Ids of settlement transactions; random by default. */
  createId?: () => string;
}

/** A bankruptcy or a bid can move the version between reading and writing the settlement. */
const SETTLEMENT_ATTEMPTS = 3;

export class DefaultAuctionService implements AuctionService {
  private readonly games: GameRepository;
  private readonly players: PlayerRepository;
  private readonly transactions: TransactionRepository;
  private readonly operations: BankingOperationRepository;
  private readonly paymentRequests: PaymentRequestRepository;
  private readonly auctions: AuctionRepository;
  private readonly now: () => number;
  private readonly createId: () => string;

  constructor(dependencies: AuctionServiceDependencies) {
    this.games = dependencies.games;
    this.players = dependencies.players;
    this.transactions = dependencies.transactions;
    this.operations = dependencies.operations;
    this.paymentRequests = dependencies.paymentRequests;
    this.auctions = dependencies.auctions;
    this.now = dependencies.now ?? Date.now;
    this.createId = dependencies.createId ?? (() => crypto.randomUUID());
  }

  async getCurrent(gameId: string): Promise<Auction | null> {
    const game = await this.games.getById(gameId);
    if (game === null) throw new ResourceNotFoundError('Game');
    if (!game.rules.auctions) return null;
    return this.auctions.getCurrent(gameId, this.now());
  }

  async startAuction(
    gameId: string,
    request: StartAuctionRequest,
    auctionId: string,
  ): Promise<AuctionResponse> {
    const game = await this.requireActiveAuctionGame(gameId);
    const existing = await this.auctions.getById(gameId, auctionId);
    if (existing !== null) return { auction: existing };
    const lotName = normalizePropertyName(request.lotName);
    if (lotName === null)
      throw new ValidationError('lotName must be 1 to 60 characters without control characters.', {
        field: 'lotName',
      });
    const players = await this.players.listByGameId(gameId);
    const initiator = players.find((player) => player.id === request.initiatorPlayerId);
    if (initiator === undefined) throw new PlayerNotFoundError(request.initiatorPlayerId);
    if (initiator.status === 'BANKRUPT') throw new PlayerBankruptError(initiator.id);
    const running = await this.auctions.getActive(gameId);
    if (running !== null) throw new AuctionAlreadyActiveError(running.id);
    const startedAtMs = this.now();
    try {
      await this.auctions.create({
        id: auctionId,
        gameId: game.id,
        lotName,
        initiatorPlayerId: initiator.id,
        startedAt: new Date(startedAtMs).toISOString(),
        endsAt: new Date(startedAtMs + AUCTION_DURATION_MS).toISOString(),
      });
    } catch (error) {
      // Two starts race on the unique running auction; the loser says so plainly.
      const winner = error instanceof DatabaseError ? await this.auctions.getActive(gameId) : null;
      if (winner !== null && winner.id !== auctionId)
        throw new AuctionAlreadyActiveError(winner.id);
      throw error;
    }
    return { auction: await this.requireAuction(gameId, auctionId) };
  }

  async placeBid(gameId: string, request: PlaceBidRequest): Promise<AuctionResponse> {
    const game = await this.requireActiveAuctionGame(gameId);
    const settings = game.settings;
    // A game without the settings snapshot cannot run auctions: there are no bid steps.
    if (settings === null) throw new RuleDisabledError('auctions');
    const auction = await this.auctions.getById(gameId, request.auctionId);
    if (auction === null) throw new AuctionNotFoundError(request.auctionId);
    const players = await this.players.listByGameId(gameId);
    const bidder = players.find((player) => player.id === request.bidderPlayerId);
    if (bidder === undefined) throw new PlayerNotFoundError(request.bidderPlayerId);
    const nowMs = this.now();
    const bid = validateBid({
      auction,
      settings,
      bidder,
      expectedVersion: request.expectedVersion,
      step: request.step,
      reservedByRequests: await this.paymentRequests.pendingReservedAmount(gameId, bidder.id),
      nowMs,
    });
    const written = await this.auctions.placeBid({
      gameId,
      auctionId: auction.id,
      expectedVersion: auction.version,
      bid,
      bidderPlayerId: bidder.id,
      nowIso: new Date(nowMs).toISOString(),
      minEndsAtIso: new Date(nowMs + AUCTION_BID_EXTENSION_MS).toISOString(),
    });
    if (!written) {
      // Lost a race (or the bidder spent the money meanwhile): say why from what is stored now.
      const current = await this.requireAuction(gameId, auction.id);
      const fresh = (await this.players.listByGameId(gameId)).find((item) => item.id === bidder.id);
      validateBid({
        auction: current,
        settings,
        bidder: fresh ?? bidder,
        expectedVersion: request.expectedVersion,
        step: request.step,
        reservedByRequests: await this.paymentRequests.pendingReservedAmount(gameId, bidder.id),
        nowMs: this.now(),
      });
      throw new AuctionBidStaleError(current);
    }
    return { auction: await this.requireAuction(gameId, auction.id) };
  }

  async settleDue(gameId: string, auctionId: string): Promise<AuctionResponse | null> {
    const game = await this.games.getById(gameId);
    if (game === null) throw new ResourceNotFoundError('Game');
    let auction = await this.auctions.getById(gameId, auctionId);
    if (auction === null) throw new AuctionNotFoundError(auctionId);
    for (
      let attempt = 0;
      attempt < SETTLEMENT_ATTEMPTS && isAuctionDue(auction, this.now());
      attempt += 1
    ) {
      await this.settleOnce(game, auction);
      const reloaded = await this.auctions.getById(gameId, auctionId);
      if (reloaded === null) throw new AuctionNotFoundError(auctionId);
      auction = reloaded;
    }
    if (auction.state === 'ACTIVE') return null;
    return this.closedResponse(auction);
  }

  /** One attempt. A rolled-back batch just means the auction moved on; the caller re-reads it. */
  private async settleOnce(game: Game, auction: Auction): Promise<void> {
    const players = await this.players.listByGameId(game.id);
    const plan = planAuctionSettlement({ game, players, auction });
    if (plan.kind === 'NO_SALE') {
      // False means a bankruptcy or another settlement moved the version; the caller re-reads.
      await this.auctions.closeWithoutSale(game.id, auction.id, auction.version);
      return;
    }
    try {
      await this.operations.persist({
        // Server-generated: a client-chosen command ID can never occupy it. Exactly-once comes
        // from the guarded batch, not from a predictable id.
        transactionId: this.createId(),
        transaction: {
          ...plan.result.transaction,
          settlesAuction: { auctionId: auction.id, expectedVersion: auction.version },
        },
        balanceChanges: plan.result.affectedPlayers,
      });
    } catch (error) {
      // A concurrent settlement or bankruptcy won if the auction moved on; anything else is real.
      const current = await this.auctions.getById(game.id, auction.id);
      if (
        !(error instanceof DatabaseError) ||
        (current?.state === 'ACTIVE' && current.version === auction.version)
      )
        throw error;
    }
  }

  private async closedResponse(auction: Auction): Promise<AuctionResponse> {
    if (auction.state !== 'SOLD' || auction.settledTransactionId === null) return { auction };
    const transaction = await this.transactions.getById(
      auction.gameId,
      auction.settledTransactionId,
    );
    if (transaction === null) throw new PersistenceConsistencyError();
    return { auction, transaction, players: await this.players.listByGameId(auction.gameId) };
  }

  private async requireAuction(gameId: string, auctionId: string): Promise<Auction> {
    const auction = await this.auctions.getById(gameId, auctionId);
    if (auction === null) throw new PersistenceConsistencyError();
    return auction;
  }

  private async requireActiveAuctionGame(gameId: string): Promise<Game> {
    const game = await this.games.getById(gameId);
    if (game === null) throw new ResourceNotFoundError('Game');
    assertRuleEnabled(game, 'auctions');
    if (game.status !== 'ACTIVE') throw new InvalidGameStateError(`game status is ${game.status}`);
    return game;
  }
}
