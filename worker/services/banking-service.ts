import type {
  CreateTransactionRequest,
  CreateTransactionResponse,
} from '../../shared/contracts/api.js';
import {
  allToPlayer,
  bankToPlayer,
  passGo,
  payRent,
  playerToAll,
  playerToBank,
  playerToPlayer,
  type BankingOperationResult,
} from '../../shared/domain/banking.js';
import type { Transaction } from '../../shared/types/monopoly.js';
import type { BankingOperationRepository } from '../repositories/banking-operation-repository.js';
import type { GameRepository } from '../repositories/game-repository.js';
import type { PlayerRepository } from '../repositories/player-repository.js';
import type { TransactionRepository } from '../repositories/transaction-repository.js';
import { PersistenceConsistencyError, ResourceNotFoundError } from './errors.js';

export interface BankingService {
  createTransaction(gameId: string, request: CreateTransactionRequest): Promise<CreateTransactionResponse>;
  listTransactions(gameId: string, limit: number): Promise<Transaction[]>;
  listPlayerTransactions(gameId: string, playerId: string, limit: number): Promise<Transaction[]>;
}

export interface BankingServiceDependencies {
  games: GameRepository;
  players: PlayerRepository;
  transactions: TransactionRepository;
  operations: BankingOperationRepository;
  createId: () => string;
}

export class DefaultBankingService implements BankingService {
  private readonly games: GameRepository;
  private readonly players: PlayerRepository;
  private readonly transactions: TransactionRepository;
  private readonly operations: BankingOperationRepository;
  private readonly createId: () => string;

  constructor(dependencies: BankingServiceDependencies) {
    this.games = dependencies.games;
    this.players = dependencies.players;
    this.transactions = dependencies.transactions;
    this.operations = dependencies.operations;
    this.createId = dependencies.createId;
  }

  async createTransaction(
    gameId: string,
    request: CreateTransactionRequest,
  ): Promise<CreateTransactionResponse> {
    const game = await this.games.getById(gameId);
    if (game === null) {
      throw new ResourceNotFoundError('Game');
    }
    const players = await this.players.listByGameId(gameId);
    const result = executeOperation(game, players, request);
    const transactionId = this.createId();

    await this.operations.persist({
      transactionId,
      transaction: result.transaction,
      balanceChanges: result.affectedPlayers,
    });

    const transaction = await this.transactions.getById(gameId, transactionId);
    if (transaction === null) {
      throw new PersistenceConsistencyError();
    }

    return {
      transaction,
      players: await this.players.listByGameId(gameId),
    };
  }

  async listTransactions(gameId: string, limit: number): Promise<Transaction[]> {
    await this.ensureGameExists(gameId);
    return this.transactions.listByGameId(gameId, limit);
  }

  async listPlayerTransactions(gameId: string, playerId: string, limit: number): Promise<Transaction[]> {
    await this.ensureGameExists(gameId);
    const players = await this.players.listByGameId(gameId);
    if (!players.some((player) => player.id === playerId)) {
      throw new ResourceNotFoundError('Player');
    }
    return this.transactions.listByPlayerId(gameId, playerId, limit);
  }

  private async ensureGameExists(gameId: string): Promise<void> {
    if ((await this.games.getById(gameId)) === null) {
      throw new ResourceNotFoundError('Game');
    }
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
    case 'PAY_RENT':
      return payRent({ ...request, game, players });
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
