import type {
  CreateTransactionRequest,
  CreateBankingCommandResponse,
  CreateTransactionResponse,
  PaymentRequest,
  PaymentRequestActionResponse,
} from '../../shared/contracts/api.js';
import {
  allToPlayer,
  bankToPlayer,
  passGo,
  playerToAll,
  playerToBank,
  playerToPlayer,
  type BankingOperationResult,
  declareBankruptcy,
} from '../../shared/domain/banking.js';
import type { Transaction } from '../../shared/types/monopoly.js';
import type { BankingOperationRepository } from '../repositories/banking-operation-repository.js';
import type { GameRepository } from '../repositories/game-repository.js';
import type { PlayerRepository } from '../repositories/player-repository.js';
import type { TransactionRepository } from '../repositories/transaction-repository.js';
import type { PaymentRequestRepository } from '../repositories/payment-request-repository.js';
import { ConflictError, PersistenceConsistencyError, ResourceNotFoundError } from './errors.js';

export interface BankingService {
  createTransaction(gameId: string, request: CreateTransactionRequest): Promise<CreateBankingCommandResponse>;
  listPaymentRequests(gameId: string, payerPlayerIds: readonly string[]): Promise<PaymentRequest[]>;
  acceptPaymentRequest(gameId: string, requestId: string): Promise<PaymentRequestActionResponse>;
  declinePaymentRequest(gameId: string, requestId: string): Promise<PaymentRequestActionResponse>;
  cancelPaymentRequest(gameId: string, requestId: string): Promise<PaymentRequestActionResponse>;
  getPaymentRequest(gameId: string, requestId: string): Promise<PaymentRequest | null>;
  listTransactions(gameId: string, limit: number): Promise<Transaction[]>;
  listPlayerTransactions(gameId: string, playerId: string, limit: number): Promise<Transaction[]>;
  declareBankruptcy(gameId: string, request: import('../../shared/contracts/api.js').BankruptcyRequest): Promise<CreateTransactionResponse>;
}

export interface BankingServiceDependencies {
  games: GameRepository;
  players: PlayerRepository;
  transactions: TransactionRepository;
  operations: BankingOperationRepository;
  paymentRequests: PaymentRequestRepository;
  createId: () => string;
}

export class DefaultBankingService implements BankingService {
  private readonly games: GameRepository;
  private readonly players: PlayerRepository;
  private readonly transactions: TransactionRepository;
  private readonly operations: BankingOperationRepository;
  private readonly paymentRequests: PaymentRequestRepository;
  private readonly createId: () => string;

  constructor(dependencies: BankingServiceDependencies) {
    this.games = dependencies.games;
    this.players = dependencies.players;
    this.transactions = dependencies.transactions;
    this.operations = dependencies.operations;
    this.paymentRequests = dependencies.paymentRequests;
    this.createId = dependencies.createId;
  }

  async createTransaction(
    gameId: string,
    request: CreateTransactionRequest,
  ): Promise<CreateBankingCommandResponse> {
    const game = await this.games.getById(gameId);
    if (game === null) {
      throw new ResourceNotFoundError('Game');
    }
    const players = await this.players.listByGameId(gameId);
    if (game.paymentMode === 'CONFIRMATION' && (request.type === 'PLAYER_TO_PLAYER' || request.type === 'ALL_TO_PLAYER')) {
      return this.createConfirmationRequests(gameId, request, players);
    }
    const result = executeOperation(game, players, request);
    const transactionId = this.createId();

    await this.operations.persist({
      transactionId,
      transaction: result.transaction,
      balanceChanges: result.affectedPlayers,
    });

    if (request.type !== 'PASS_GO') {
      await this.games.recordRecentAmount(gameId, result.transaction.amount);
    }

    const transaction = await this.transactions.getById(gameId, transactionId);
    if (transaction === null) {
      throw new PersistenceConsistencyError();
    }

    return {
      transaction,
      players: await this.players.listByGameId(gameId),
    };
  }

  async listPaymentRequests(gameId: string, payerPlayerIds: readonly string[]): Promise<PaymentRequest[]> {
    return this.paymentRequests.listForPayers(gameId, payerPlayerIds);
  }

  async getPaymentRequest(gameId: string, requestId: string): Promise<PaymentRequest | null> {
    await this.paymentRequests.expirePending(gameId);
    return this.paymentRequests.getById(gameId, requestId);
  }

  async acceptPaymentRequest(gameId: string, requestId: string): Promise<PaymentRequestActionResponse> {
    await this.paymentRequests.expirePending(gameId);
    const paymentRequest = await this.requirePaymentRequest(gameId, requestId);
    if (paymentRequest.state === 'ACCEPTED') {
      const transaction = paymentRequest.transactionId === null ? null : await this.transactions.getById(gameId, paymentRequest.transactionId);
      if (transaction === null) throw new PersistenceConsistencyError();
      return { paymentRequest, transaction, players: await this.players.listByGameId(gameId) };
    }
    if (paymentRequest.state !== 'PENDING') throw new ConflictError('PAYMENT_REQUEST_NOT_PENDING', 'This payment request is no longer pending.');
    const game = await this.games.getById(gameId); if (game === null) throw new ResourceNotFoundError('Game');
    const players = await this.players.listByGameId(gameId);
    const result = playerToPlayer({ game, players, sourcePlayerId: paymentRequest.payerPlayerId, destinationPlayerId: paymentRequest.recipientPlayerId, amount: paymentRequest.amount, ...(paymentRequest.comment === null ? {} : { comment: paymentRequest.comment }) });
    const transactionId = this.createId();
    await this.paymentRequests.settle({ requestId, transactionId, transaction: result.transaction, balanceChanges: result.affectedPlayers });
    const transaction = await this.transactions.getById(gameId, transactionId); if (transaction === null) throw new PersistenceConsistencyError();
    const accepted = await this.requirePaymentRequest(gameId, requestId);
    await this.games.recordRecentAmount(gameId, paymentRequest.amount);
    return { paymentRequest: accepted, transaction, players: await this.players.listByGameId(gameId) };
  }

  async declinePaymentRequest(gameId: string, requestId: string): Promise<PaymentRequestActionResponse> { return this.resolvePaymentRequest(gameId, requestId, 'DECLINED'); }
  async cancelPaymentRequest(gameId: string, requestId: string): Promise<PaymentRequestActionResponse> { return this.resolvePaymentRequest(gameId, requestId, 'CANCELLED'); }

  async listTransactions(gameId: string, limit: number): Promise<Transaction[]> {
    return this.transactions.listByGameId(gameId, limit);
  }

  async listPlayerTransactions(gameId: string, playerId: string, limit: number): Promise<Transaction[]> {
    const [players, transactions] = await Promise.all([
      this.players.listByGameId(gameId),
      this.transactions.listByPlayerId(gameId, playerId, limit),
    ]);
    if (!players.some((player) => player.id === playerId)) {
      throw new ResourceNotFoundError('Player');
    }
    return transactions;
  }

  async declareBankruptcy(gameId: string, request: import('../../shared/contracts/api.js').BankruptcyRequest): Promise<CreateTransactionResponse> {
    const game = await this.games.getById(gameId); if (game === null) throw new ResourceNotFoundError('Game');
    const players = await this.players.listByGameId(gameId);
    const result = declareBankruptcy({ game, players, ...request });
    const transactionId = this.createId();
    await this.operations.persist({ transactionId, transaction: result.transaction, balanceChanges: result.affectedPlayers, bankruptPlayerId: request.playerId });
    const transaction = await this.transactions.getById(gameId, transactionId); if (transaction === null) throw new PersistenceConsistencyError();
    return { transaction, players: await this.players.listByGameId(gameId) };
  }

  private async createConfirmationRequests(gameId: string, request: Extract<CreateTransactionRequest, { type: 'PLAYER_TO_PLAYER' | 'ALL_TO_PLAYER' }>, players: Awaited<ReturnType<PlayerRepository['listByGameId']>>): Promise<import('../../shared/contracts/api.js').CreatePaymentRequestResponse> {
    const pairs = request.type === 'PLAYER_TO_PLAYER'
      ? [{ payerPlayerId: request.sourcePlayerId, recipientPlayerId: request.destinationPlayerId, creatorPlayerId: request.sourcePlayerId, approverPlayerId: request.destinationPlayerId, amount: request.amount, comment: request.comment ?? null }]
      : players.filter((player) => player.id !== request.recipientPlayerId).map((player) => ({ payerPlayerId: player.id, recipientPlayerId: request.recipientPlayerId, creatorPlayerId: request.recipientPlayerId, approverPlayerId: player.id, amount: request.amountPerPlayer, comment: request.comment ?? null }));
    for (const pair of pairs) {
      const payer = players.find((player) => player.id === pair.payerPlayerId);
      if (payer === undefined || pair.payerPlayerId === pair.recipientPlayerId) throw new ConflictError('INVALID_PAYMENT_REQUEST', 'Payment request participants are invalid.');
      const reserved = await this.paymentRequests.pendingReservedAmount(gameId, payer.id);
      if (payer.balance - reserved < pair.amount) throw new ConflictError('INSUFFICIENT_AVAILABLE_FUNDS', 'Player does not have enough available funds.');
    }
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const paymentRequests = await Promise.all(pairs.map(async (pair) => {
      const id = this.createId();
      const paymentRequest: Omit<PaymentRequest, 'createdAt' | 'resolvedAt' | 'transactionId'> = { id, gameId, ...pair, state: 'PENDING', expiresAt };
      await this.paymentRequests.create(paymentRequest);
      return (await this.paymentRequests.getById(gameId, id)) as PaymentRequest;
    }));
    return { paymentRequests, players };
  }

  private async resolvePaymentRequest(gameId: string, requestId: string, state: 'DECLINED' | 'CANCELLED'): Promise<PaymentRequestActionResponse> {
    await this.paymentRequests.expirePending(gameId);
    const current = await this.requirePaymentRequest(gameId, requestId);
    if (current.state === 'PENDING') await this.paymentRequests.resolve(requestId, state);
    return { paymentRequest: await this.requirePaymentRequest(gameId, requestId), players: await this.players.listByGameId(gameId) };
  }

  private async requirePaymentRequest(gameId: string, requestId: string): Promise<PaymentRequest> {
    const paymentRequest = await this.paymentRequests.getById(gameId, requestId);
    if (paymentRequest === null) throw new ResourceNotFoundError('Payment request');
    return paymentRequest;
  }
}

function executeOperation(
  game: Parameters<typeof playerToPlayer>[0]['game'],
  players: Parameters<typeof playerToPlayer>[0]['players'],
  request: CreateTransactionRequest,
): BankingOperationResult {
  switch (request.type) {
    case 'PLAYER_TO_PLAYER':
      return playerToPlayer({ ...request, game, players });
    case 'PLAYER_TO_BANK':
      return playerToBank({ ...request, game, players });
    case 'BANK_TO_PLAYER':
      return bankToPlayer({ ...request, game, players });
    case 'PLAYER_TO_ALL':
      return playerToAll({ ...request, game, players });
    case 'ALL_TO_PLAYER':
      return allToPlayer({ ...request, game, players });
    case 'PASS_GO':
      return passGo({ ...request, game, players });
  }
}
