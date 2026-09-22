import type { CreateTradeRequest, PropertyTrade, PropertyTradeItem, TradeActionResponse } from '../../shared/contracts/api.js';
import { applyTrade, proposeTrade, type TradeProposal } from '../../shared/domain/property-trade.js';
import { BuildingsPresentError, findBoardSpace } from '../../shared/domain/property.js';
import type { BankingOperationRepository } from '../repositories/banking-operation-repository.js';
import type { PropertyTradeRepository } from '../repositories/property-trade-repository.js';
import type { TransactionRepository } from '../repositories/transaction-repository.js';
import { ConflictError, PersistenceConsistencyError, ResourceNotFoundError } from './errors.js';
import { loadPropertyWorld, propertyCommandBase, propertyWrites, type PropertyWorldDependencies } from './property-service.js';

export interface PropertyTradeService {
  list(gameId: string): Promise<PropertyTrade[]>;
  get(gameId: string, tradeId: string): Promise<PropertyTrade | null>;
  propose(gameId: string, request: CreateTradeRequest): Promise<TradeActionResponse>;
  accept(gameId: string, tradeId: string): Promise<TradeActionResponse>;
  decline(gameId: string, tradeId: string): Promise<TradeActionResponse>;
  cancel(gameId: string, tradeId: string): Promise<TradeActionResponse>;
}

export interface PropertyTradeServiceDependencies extends PropertyWorldDependencies {
  trades: PropertyTradeRepository;
  transactions: TransactionRepository;
  operations: BankingOperationRepository;
  /** Returns the command id inside the coordinator: a proposal's id, or an acceptance's transaction id. */
  createId: () => string;
  now?: () => Date;
}

const tradeTtlMs = 24 * 60 * 60 * 1000;

/**
 * The offer ledger's service. A proposal is validated by the domain against the
 * current slice and stored; acceptance rebuilds the proposal from the stored
 * items and lets `applyTrade` re-check every deed before anything is written.
 *
 * Deeds carrying buildings cannot be offered. The stored item does not record
 * how many buildings stood on a deed when it was offered, so acceptance could
 * not tell "two houses then, three now" apart; and the domain, as it stands,
 * would sell only the traded deed's buildings and break the even-building rule
 * on the rest of the group. Selling to the bank first is also how the official
 * rules order it, so the safer side is chosen until the operator settles the
 * open question from phase 3.
 */
export class DefaultPropertyTradeService implements PropertyTradeService {
  private readonly dependencies: PropertyTradeServiceDependencies;
  private readonly now: () => Date;

  constructor(dependencies: PropertyTradeServiceDependencies) {
    this.dependencies = dependencies;
    this.now = dependencies.now ?? (() => new Date());
  }

  async list(gameId: string): Promise<PropertyTrade[]> {
    await this.dependencies.trades.expirePending(gameId);
    return this.dependencies.trades.listByGameId(gameId);
  }

  async get(gameId: string, tradeId: string): Promise<PropertyTrade | null> {
    await this.dependencies.trades.expirePending(gameId);
    return this.dependencies.trades.getById(gameId, tradeId);
  }

  async propose(gameId: string, request: CreateTradeRequest): Promise<TradeActionResponse> {
    const tradeId = this.dependencies.createId();
    const existing = await this.dependencies.trades.getById(gameId, tradeId);
    if (existing !== null) return { trade: existing, players: await this.dependencies.players.listByGameId(gameId) };

    const world = await loadPropertyWorld(this.dependencies, gameId);
    const proposal = proposeTrade({
      ...propertyCommandBase(world),
      proposerPlayerId: request.proposerPlayerId,
      responderPlayerId: request.responderPlayerId,
      cashFromProposer: request.cashFromProposer,
      cashFromResponder: request.cashFromResponder,
      propertiesFromProposer: request.propertiesFromProposer,
      propertiesFromResponder: request.propertiesFromResponder,
      comment: request.comment,
    });
    for (const item of proposal.items) {
      if (item.recordedState.houses > 0) throw new BuildingsPresentError(findBoardSpace(world.slice.boardSpaces, item.boardSpaceId).colorGroup);
    }

    const items: PropertyTradeItem[] = proposal.items.map((item) => ({ boardSpaceId: item.boardSpaceId, fromPlayerId: item.fromPlayerId, mortgageResolution: item.mortgageResolution }));
    await this.dependencies.trades.create({
      trade: {
        id: tradeId,
        gameId,
        proposerPlayerId: proposal.proposerPlayerId,
        responderPlayerId: proposal.responderPlayerId,
        cashFromProposer: proposal.cashFromProposer,
        cashFromResponder: proposal.cashFromResponder,
        state: 'PENDING',
        expiresAt: new Date(this.now().getTime() + tradeTtlMs).toISOString(),
      },
      items,
      boardId: world.slice.board.id,
    });
    return { trade: await this.requireTrade(gameId, tradeId), players: world.players };
  }

  async accept(gameId: string, tradeId: string): Promise<TradeActionResponse> {
    await this.dependencies.trades.expirePending(gameId);
    const trade = await this.requireTrade(gameId, tradeId);
    if (trade.state === 'ACCEPTED') return this.acceptedResponse(gameId, trade);
    if (trade.state !== 'PENDING') throw new ConflictError('TRADE_NOT_PENDING', 'This trade is no longer pending.', { state: trade.state });

    const world = await loadPropertyWorld(this.dependencies, gameId);
    const result = applyTrade({ ...propertyCommandBase(world), proposal: toProposal(trade) });
    const transactionId = this.dependencies.createId();
    await this.dependencies.operations.persist({
      transactionId,
      transaction: result.transaction,
      balanceChanges: result.affectedPlayers,
      propertyChanges: propertyWrites(world.slice, result),
      buildingBankDelta: result.buildingBankDelta,
      tradeSettlement: { tradeId },
    });
    return this.acceptedResponse(gameId, await this.requireTrade(gameId, tradeId));
  }

  async decline(gameId: string, tradeId: string): Promise<TradeActionResponse> { return this.resolve(gameId, tradeId, 'DECLINED'); }
  async cancel(gameId: string, tradeId: string): Promise<TradeActionResponse> { return this.resolve(gameId, tradeId, 'CANCELLED'); }

  private async resolve(gameId: string, tradeId: string, state: 'DECLINED' | 'CANCELLED'): Promise<TradeActionResponse> {
    await this.dependencies.trades.expirePending(gameId);
    const current = await this.requireTrade(gameId, tradeId);
    if (current.state === 'PENDING') await this.dependencies.trades.resolve(gameId, tradeId, state);
    return { trade: await this.requireTrade(gameId, tradeId), players: await this.dependencies.players.listByGameId(gameId) };
  }

  private async acceptedResponse(gameId: string, trade: PropertyTrade): Promise<TradeActionResponse> {
    const transaction = trade.transactionId === null ? null : await this.dependencies.transactions.getById(gameId, trade.transactionId);
    if (transaction === null) throw new PersistenceConsistencyError();
    const world = await loadPropertyWorld(this.dependencies, gameId);
    return { trade, players: world.players, transaction, properties: world.slice.properties, buildingBank: world.slice.buildingBank };
  }

  private async requireTrade(gameId: string, tradeId: string): Promise<PropertyTrade> {
    const trade = await this.dependencies.trades.getById(gameId, tradeId);
    if (trade === null) throw new ResourceNotFoundError('Trade');
    return trade;
  }
}

/**
 * Rebuilds the domain proposal from the stored offer. The recorded deed state is
 * what the proposal guaranteed: the giver still owns it, it carries no buildings
 * (proposals with buildings are refused), and it is mortgaged exactly when the
 * offer named a mortgage resolution. `applyTrade` compares that against the
 * live slice and refuses the whole trade on any drift.
 */
export function toProposal(trade: PropertyTrade): TradeProposal {
  return {
    gameId: trade.gameId,
    proposerPlayerId: trade.proposerPlayerId,
    responderPlayerId: trade.responderPlayerId,
    cashFromProposer: trade.cashFromProposer,
    cashFromResponder: trade.cashFromResponder,
    items: trade.items.map((item) => ({
      boardSpaceId: item.boardSpaceId,
      fromPlayerId: item.fromPlayerId,
      mortgageResolution: item.mortgageResolution,
      recordedState: { ownerPlayerId: item.fromPlayerId, houses: 0, mortgaged: item.mortgageResolution !== null },
    })),
  };
}
