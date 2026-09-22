import type { CreateGameRequest, DeleteGameResponse, GameDetails, GameSummary } from '../../shared/contracts/api.js';
import type { Currency } from '../../shared/types/monopoly.js';
import type { CreateGameBoardInput, GameRepository } from '../repositories/game-repository.js';
import type { CreatePlayerInput, PlayerRepository } from '../repositories/player-repository.js';
import type { PropertyRepository } from '../repositories/property-repository.js';
import { ConflictError, NotFoundError, ResourceNotFoundError } from './errors.js';
import { hashPassword, randomToken } from './password-security.js';

/** The API only lets a new game pick a selectable currency; duplicating keeps the source game's stored currency, including the legacy `K`. */
export type CreateGameInput = Omit<CreateGameRequest, 'currency'> & { currency: Currency };

export interface GameService {
  listGames(): Promise<GameSummary[]>;
  listGamesForUser(userId: string): Promise<GameSummary[]>;
  createGameForOwner(userId: string, request: CreateGameInput): Promise<GameDetails>;
  getGame(gameId: string): Promise<GameDetails>;
  deleteGame(gameId: string): Promise<DeleteGameResponse>;
  duplicateGameForOwner(userId: string, gameId: string, gameAccessPassword: string): Promise<GameDetails>;
  startGame(gameId: string): Promise<GameDetails>;
  finishGame(gameId: string): Promise<GameDetails>;
  toggleFavoriteAmount(gameId: string, amount: number): Promise<number[]>;
}

export interface GameServiceDependencies {
  games: GameRepository;
  players: PlayerRepository;
  createId: () => string;
  /** Needed only for games that opt into a board; a service without it serves board-less games exactly as before. */
  properties?: PropertyRepository;
}

export class DefaultGameService implements GameService {
  private readonly games: GameRepository;
  private readonly players: PlayerRepository;
  private readonly properties: PropertyRepository | undefined;
  private readonly createId: () => string;

  constructor(dependencies: GameServiceDependencies) {
    this.games = dependencies.games;
    this.players = dependencies.players;
    this.properties = dependencies.properties;
    this.createId = dependencies.createId;
  }

  async listGames(): Promise<GameSummary[]> {
    return this.games.listSummaries();
  }
  async listGamesForUser(userId: string): Promise<GameSummary[]> { return this.games.listSummariesForUser(userId); }

  async createGameForOwner(userId: string, request: CreateGameInput): Promise<GameDetails> {
    const gameAccessCredentials = request.gameAccessPassword === undefined ? { hash: '', salt: '' } : await hashPassword(request.gameAccessPassword);
    const board = request.boardId === undefined ? undefined : await this.resolveBoardForCreation(userId, request.boardId);
    return this.createGameInternal(request, { userId, joinCode: randomToken(5).toUpperCase().replace(/[^A-Z0-9]/gu, 'X').slice(0, 8), ...gameAccessCredentials, hasPassword: request.gameAccessPassword !== undefined }, board);
  }

  /**
   * A canonical board is open to everyone; a copy only to its owner. Somebody
   * else's copy answers exactly like a board that does not exist, so the id
   * space of private boards cannot be probed.
   */
  private async resolveBoardForCreation(userId: string, boardId: string): Promise<CreateGameBoardInput> {
    if (this.properties === undefined) throw new NotFoundError('BOARD_NOT_FOUND', 'Board not found.');
    const board = await this.properties.getBoard(boardId);
    if (board === null || (board.ownerUserId !== null && board.ownerUserId !== userId)) throw new NotFoundError('BOARD_NOT_FOUND', 'Board not found.');
    const spaces = await this.properties.listSpaces(boardId);
    if (spaces.length === 0) throw new NotFoundError('BOARD_NOT_FOUND', 'Board not found.');
    return { id: board.id, spaceIds: spaces.map((space) => space.id), houseBankLimit: board.houseBankLimit, hotelBankLimit: board.hotelBankLimit };
  }

  private async createGameInternal(request: CreateGameInput, owner: { userId: string; joinCode: string; hash: string; salt: string; hasPassword: boolean }, board?: CreateGameBoardInput): Promise<GameDetails> {
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
        status: 'LOBBY', paymentMode: request.paymentMode ?? 'FAST', ownerUserId: owner.userId, joinCode: owner.joinCode, gameAccessPasswordHash: owner.hasPassword ? owner.hash : null, gameAccessPasswordSalt: owner.hasPassword ? owner.salt : null,
        ...(board === undefined ? {} : { board }),
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

    // The four board fields exist only for a game that opted into a board; a board-less game omits them all.
    const slice = game.boardId === null || game.boardId === undefined || this.properties === undefined ? null : await this.properties.loadPropertySlice(gameId);
    return {
      game,
      players: await this.players.listByGameId(gameId),
      favoriteAmounts: await this.games.listFavoriteAmounts(gameId),
      recentAmounts: await this.games.listRecentAmounts(gameId),
      ...(slice === null ? {} : slice),
    };
  }

  async deleteGame(gameId: string): Promise<DeleteGameResponse> {
    if (!(await this.games.delete(gameId))) {
      throw new ResourceNotFoundError('Game');
    }

    return { gameId };
  }

  async duplicateGameForOwner(userId: string, gameId: string, gameAccessPassword: string): Promise<GameDetails> {
    const source = await this.getGame(gameId);
    return this.createGameForOwner(userId, {
      name: `${source.game.name} (Copy)`,
      startingBalance: source.game.startingBalance,
      passGoReward: source.game.passGoReward,
      currency: source.game.currency,
      paymentMode: source.game.paymentMode,
      gameAccessPassword,
      players: source.players.map((player) => ({ name: player.name, color: player.color })),
    });
  }

  async startGame(gameId: string): Promise<GameDetails> {
    const details = await this.getGame(gameId);
    if (details.game.status !== 'LOBBY') throw new ConflictError('INVALID_GAME_STATE', 'Only a lobby can be started.');
    if (details.players.length < 2) throw new ConflictError('INSUFFICIENT_PLAYERS', 'At least two players are required to start a game.');
    if ((await this.games.transitionStatus(gameId, 'LOBBY', 'ACTIVE')) === null) throw new ConflictError('LOBBY_CLOSED', 'This lobby is no longer available.');
    return this.getGame(gameId);
  }

  async finishGame(gameId: string): Promise<GameDetails> {
    const game = await this.games.getById(gameId);
    if (game === null) throw new ResourceNotFoundError('Game');
    if (game.status !== 'ACTIVE') throw new ConflictError('INVALID_GAME_STATE', 'Only an active game can be finished.');
    if ((await this.games.transitionStatus(gameId, 'ACTIVE', 'FINISHED')) === null) throw new ConflictError('INVALID_GAME_STATE', 'This game is no longer active.');
    return this.getGame(gameId);
  }

  async toggleFavoriteAmount(gameId: string, amount: number): Promise<number[]> {
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Favorite amount must be a positive integer.');
    if ((await this.games.getById(gameId)) === null) throw new ResourceNotFoundError('Game');
    return this.games.toggleFavoriteAmount(gameId, amount);
  }
}
