import type { CreateGameRequest, GameDetails, GameSummary } from '../../shared/contracts/api.js';
import type { GameRepository } from '../repositories/game-repository.js';
import type { CreatePlayerInput, PlayerRepository } from '../repositories/player-repository.js';
import { ResourceNotFoundError } from './errors.js';

export interface GameService {
  listGames(): Promise<GameSummary[]>;
  createGame(request: CreateGameRequest): Promise<GameDetails>;
  getGame(gameId: string): Promise<GameDetails>;
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

  async createGame(request: CreateGameRequest): Promise<GameDetails> {
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
    };
  }
}
