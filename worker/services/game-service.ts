import type { CreateGameRequest, DeleteGameResponse, GameDetails, GameSummary } from '../../shared/contracts/api.js';
import type { GameRepository } from '../repositories/game-repository.js';
import type { CreatePlayerInput, PlayerRepository } from '../repositories/player-repository.js';
import { ResourceNotFoundError } from './errors.js';
import { hashPassword, randomToken } from './password-security.js';

export interface GameService {
  listGames(): Promise<GameSummary[]>;
  listGamesForUser(userId: string): Promise<GameSummary[]>;
  createGame(request: CreateGameRequest): Promise<GameDetails>;
  createGameForOwner(userId: string, request: CreateGameRequest): Promise<GameDetails>;
  getGame(gameId: string): Promise<GameDetails>;
  deleteGame(gameId: string): Promise<DeleteGameResponse>;
  duplicateGame(gameId: string): Promise<GameDetails>;
  duplicateGameForOwner(userId: string, gameId: string, gameAccessPassword: string): Promise<GameDetails>;
  finishGame(gameId: string): Promise<GameDetails>;
  toggleFavoriteAmount(gameId: string, amount: number): Promise<number[]>;
}

export interface GameServiceDependencies {
  games: GameRepository;
  players: PlayerRepository;
  createId: () => string;
}

export class DefaultGameService implements GameService {
  private readonly games: GameRepository;
  private readonly players: PlayerRepository;
  private readonly createId: () => string;

  constructor(dependencies: GameServiceDependencies) {
    this.games = dependencies.games;
    this.players = dependencies.players;
    this.createId = dependencies.createId;
  }

  async listGames(): Promise<GameSummary[]> {
    return this.games.listSummaries();
  }
  async listGamesForUser(userId: string): Promise<GameSummary[]> { return this.games.listSummariesForUser(userId); }

  async createGame(request: CreateGameRequest): Promise<GameDetails> {
    return this.createGameInternal(request);
  }

  async createGameForOwner(userId: string, request: CreateGameRequest): Promise<GameDetails> {
    const gameAccessCredentials = await hashPassword(request.gameAccessPassword);
    return this.createGameInternal(request, { userId, joinCode: randomToken(5).toUpperCase().replace(/[^A-Z0-9]/gu, 'X').slice(0, 8), ...gameAccessCredentials });
  }

  private async createGameInternal(request: CreateGameRequest, owner?: { userId: string; joinCode: string; hash: string; salt: string }): Promise<GameDetails> {
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
        ...(owner === undefined ? {} : { ownerUserId: owner.userId, joinCode: owner.joinCode, gameAccessPasswordHash: owner.hash, gameAccessPasswordSalt: owner.salt }),
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

    return {
      game,
      players: await this.players.listByGameId(gameId),
      favoriteAmounts: await this.games.listFavoriteAmounts(gameId),
      recentAmounts: await this.games.listRecentAmounts(gameId),
    };
  }

  async deleteGame(gameId: string): Promise<DeleteGameResponse> {
    if (!(await this.games.delete(gameId))) {
      throw new ResourceNotFoundError('Game');
    }

    return { gameId };
  }

  async duplicateGame(gameId: string): Promise<GameDetails> {
    const source = await this.getGame(gameId);
    const copyId = this.createId();
    await this.games.createWithPlayers({ id: copyId, name: `${source.game.name} (Copy)`, startingBalance: source.game.startingBalance, passGoReward: source.game.passGoReward, currency: source.game.currency }, source.players.map((player) => ({ id: this.createId(), gameId: copyId, name: player.name, color: player.color, balance: source.game.startingBalance })));
    for (const amount of source.favoriteAmounts ?? []) {
      await this.games.toggleFavoriteAmount(copyId, amount);
    }
    return this.getGame(copyId);
  }

  async duplicateGameForOwner(userId: string, gameId: string, gameAccessPassword: string): Promise<GameDetails> {
    const source = await this.getGame(gameId);
    return this.createGameForOwner(userId, {
      name: `${source.game.name} (Copy)`,
      startingBalance: source.game.startingBalance,
      passGoReward: source.game.passGoReward,
      currency: source.game.currency,
      gameAccessPassword,
      players: source.players.map((player) => ({ name: player.name, color: player.color })),
    });
  }

  async finishGame(gameId: string): Promise<GameDetails> {
    if ((await this.games.updateMetadata({ id: gameId, status: 'FINISHED' })) === null) throw new ResourceNotFoundError('Game');
    return this.getGame(gameId);
  }

  async toggleFavoriteAmount(gameId: string, amount: number): Promise<number[]> {
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Favorite amount must be a positive integer.');
    if ((await this.games.getById(gameId)) === null) throw new ResourceNotFoundError('Game');
    return this.games.toggleFavoriteAmount(gameId, amount);
  }
}
