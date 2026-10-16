import type {
  CreateGameRequest,
  DeleteGameResponse,
  DeletedGameSummary,
  GameDetails,
  GameSummary,
  RestoreGameResponse,
} from '../../shared/contracts/api.js';
import { buildGameSettings } from '../../shared/domain/game-rules.js';
import { defaultGameRules, type Currency } from '../../shared/types/monopoly.js';
import type { GameRepository } from '../repositories/game-repository.js';
import type { LoanRepository } from '../repositories/loan-repository.js';
import type { MortgageRepository } from '../repositories/mortgage-repository.js';
import type { CreatePlayerInput, PlayerRepository } from '../repositories/player-repository.js';
import type { TransactionRepository } from '../repositories/transaction-repository.js';
import { loadBankLoanView } from './bank-loan-view.js';
import { ConflictError, ResourceNotFoundError } from './errors.js';
import { hashPassword, randomToken } from './password-security.js';

/** The API only lets a new game pick a selectable currency; duplicating keeps the source game's stored currency, including the legacy `K`. */
export type CreateGameInput = Omit<CreateGameRequest, 'currency'> & { currency: Currency };

export interface GameService {
  listGames(): Promise<GameSummary[]>;
  listGamesForUser(userId: string): Promise<GameSummary[]>;
  createGameForOwner(userId: string, request: CreateGameInput): Promise<GameDetails>;
  getGame(gameId: string): Promise<GameDetails>;
  listDeletedGamesForUser(userId: string): Promise<DeletedGameSummary[]>;
  deleteGame(gameId: string): Promise<DeleteGameResponse>;
  restoreGame(gameId: string, userId: string): Promise<RestoreGameResponse>;
  duplicateGameForOwner(
    userId: string,
    gameId: string,
    gameAccessPassword: string,
  ): Promise<GameDetails>;
  startGame(gameId: string): Promise<GameDetails>;
  finishGame(gameId: string): Promise<GameDetails>;
  toggleFavoriteAmount(gameId: string, amount: number): Promise<number[]>;
}

export interface GameServiceDependencies {
  games: GameRepository;
  players: PlayerRepository;
  /** Lists the properties mortgaged in a game; without it a game reports none. */
  mortgages?: MortgageRepository;
  /** Lists the loans still being repaid in a game; without it a game reports none. */
  loans?: LoanRepository;
  /** Lets a game with the bank-loans rule report loan rounds and cooldowns. */
  transactions?: TransactionRepository;
  createId: () => string;
}

export class DefaultGameService implements GameService {
  private readonly games: GameRepository;
  private readonly players: PlayerRepository;
  private readonly mortgages: MortgageRepository | undefined;
  private readonly loans: LoanRepository | undefined;
  private readonly transactions: TransactionRepository | undefined;
  private readonly createId: () => string;

  constructor(dependencies: GameServiceDependencies) {
    this.games = dependencies.games;
    this.players = dependencies.players;
    this.mortgages = dependencies.mortgages;
    this.loans = dependencies.loans;
    this.transactions = dependencies.transactions;
    this.createId = dependencies.createId;
  }

  async listGames(): Promise<GameSummary[]> {
    return this.games.listSummaries();
  }
  async listGamesForUser(userId: string): Promise<GameSummary[]> {
    return this.games.listSummariesForUser(userId);
  }

  async listDeletedGamesForUser(userId: string): Promise<DeletedGameSummary[]> {
    return this.games.listDeletedSummariesForUser(userId);
  }

  async createGameForOwner(userId: string, request: CreateGameInput): Promise<GameDetails> {
    const gameAccessCredentials =
      request.gameAccessPassword === undefined
        ? { hash: '', salt: '' }
        : await hashPassword(request.gameAccessPassword);
    return this.createGameInternal(request, {
      userId,
      joinCode: randomToken(5)
        .toUpperCase()
        .replace(/[^A-Z0-9]/gu, 'X')
        .slice(0, 8),
      ...gameAccessCredentials,
      hasPassword: request.gameAccessPassword !== undefined,
    });
  }

  private async createGameInternal(
    request: CreateGameInput,
    owner: { userId: string; joinCode: string; hash: string; salt: string; hasPassword: boolean },
  ): Promise<GameDetails> {
    const gameId = this.createId();
    const playerInputs: CreatePlayerInput[] = request.players.map((player) => ({
      id: this.createId(),
      gameId,
      name: player.name,
      color: player.color,
      balance: request.startingBalance,
    }));

    await this.games.createWithPlayers(
      {
        id: gameId,
        name: request.name,
        startingBalance: request.startingBalance,
        passGoReward: request.passGoReward,
        currency: request.currency,
        status: 'LOBBY',
        paymentMode: request.paymentMode ?? 'FAST',
        rules: request.rules ?? defaultGameRules,
        settings: buildGameSettings(request.startingBalance),
        ownerUserId: owner.userId,
        joinCode: owner.joinCode,
        gameAccessPasswordHash: owner.hasPassword ? owner.hash : null,
        gameAccessPasswordSalt: owner.hasPassword ? owner.salt : null,
      },
      playerInputs,
    );

    return this.getGame(gameId);
  }

  async getGame(gameId: string): Promise<GameDetails> {
    const game = await this.games.getById(gameId);
    if (game === null) {
      throw new ResourceNotFoundError('Game');
    }

    const players = await this.players.listByGameId(gameId);
    // With the bank-loans rule the loans carry their round and the cooldowns are reported too.
    const bankLoans =
      game.rules.bankLoans && this.loans !== undefined && this.transactions !== undefined
        ? await loadBankLoanView(
            { loans: this.loans, transactions: this.transactions },
            gameId,
            players,
          )
        : null;
    return {
      game,
      players,
      mortgages: (await this.mortgages?.listActive(gameId)) ?? [],
      loans: bankLoans?.loans ?? (await this.loans?.listActive(gameId)) ?? [],
      ...(bankLoans === null ? {} : { bankLoanCooldowns: bankLoans.bankLoanCooldowns }),
      favoriteAmounts: await this.games.listFavoriteAmounts(gameId),
      recentAmounts: await this.games.listRecentAmounts(gameId),
    };
  }

  async deleteGame(gameId: string): Promise<DeleteGameResponse> {
    if (!(await this.games.softDelete(gameId))) {
      throw new ResourceNotFoundError('Game');
    }

    return { gameId };
  }

  async restoreGame(gameId: string, userId: string): Promise<RestoreGameResponse> {
    if (!(await this.games.restore(gameId, userId))) {
      throw new ResourceNotFoundError('Game');
    }

    return { gameId };
  }

  async duplicateGameForOwner(
    userId: string,
    gameId: string,
    gameAccessPassword: string,
  ): Promise<GameDetails> {
    const source = await this.getGame(gameId);
    return this.createGameForOwner(userId, {
      name: `${source.game.name} (Copy)`,
      startingBalance: source.game.startingBalance,
      passGoReward: source.game.passGoReward,
      currency: source.game.currency,
      paymentMode: source.game.paymentMode,
      rules: source.game.rules,
      gameAccessPassword,
      players: source.players.map((player) => ({ name: player.name, color: player.color })),
    });
  }

  async startGame(gameId: string): Promise<GameDetails> {
    const details = await this.getGame(gameId);
    if (details.game.status !== 'LOBBY')
      throw new ConflictError('INVALID_GAME_STATE', 'Only a lobby can be started.');
    if (details.players.length < 2)
      throw new ConflictError(
        'INSUFFICIENT_PLAYERS',
        'At least two players are required to start a game.',
      );
    if ((await this.games.transitionStatus(gameId, 'LOBBY', 'ACTIVE')) === null)
      throw new ConflictError('LOBBY_CLOSED', 'This lobby is no longer available.');
    return this.getGame(gameId);
  }

  async finishGame(gameId: string): Promise<GameDetails> {
    const game = await this.games.getById(gameId);
    if (game === null) throw new ResourceNotFoundError('Game');
    if (game.status !== 'ACTIVE')
      throw new ConflictError('INVALID_GAME_STATE', 'Only an active game can be finished.');
    if ((await this.games.transitionStatus(gameId, 'ACTIVE', 'FINISHED')) === null)
      throw new ConflictError('INVALID_GAME_STATE', 'This game is no longer active.');
    return this.getGame(gameId);
  }

  async toggleFavoriteAmount(gameId: string, amount: number): Promise<number[]> {
    if (!Number.isSafeInteger(amount) || amount <= 0)
      throw new Error('Favorite amount must be a positive integer.');
    if ((await this.games.getById(gameId)) === null) throw new ResourceNotFoundError('Game');
    return this.games.toggleFavoriteAmount(gameId, amount);
  }
}
