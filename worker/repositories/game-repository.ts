import type { GameSummary } from '../../shared/contracts/api.js';
import type { Currency, Game, GameStatus, PaymentMode } from '../../shared/types/monopoly.js';
import type { CreatePlayerInput } from './player-repository.js';

interface GameRow {
  id: string;
  name: string;
  starting_balance: number;
  pass_go_reward: number;
  currency: Currency;
  payment_mode: PaymentMode;
  status: string;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
  board_id?: string | null;
}

/** The board a new game opts into: its id and the spaces that get an ownership row each, plus the bank limits to seed. */
export interface CreateGameBoardInput {
  id: string;
  spaceIds: readonly string[];
  houseBankLimit: number;
  hotelBankLimit: number;
}

export interface CreateGameInput {
  id: string;
  name: string;
  startingBalance: number;
  passGoReward: number;
  currency: Currency;
  paymentMode?: PaymentMode;
  status?: GameStatus;
  ownerUserId: string;
  joinCode: string;
  gameAccessPasswordHash: string | null;
  gameAccessPasswordSalt: string | null;
  board?: CreateGameBoardInput;
}

export interface UpdateGameMetadataInput {
  id: string;
  name?: string;
  status?: GameStatus;
}

export interface GameRepository {
  createWithPlayers(input: CreateGameInput, players: CreatePlayerInput[]): Promise<void>;
  getById(id: string): Promise<Game | null>;
  list(): Promise<Game[]>;
  listSummaries(): Promise<GameSummary[]>;
  listSummariesForUser(userId: string): Promise<GameSummary[]>;
  updateMetadata(input: UpdateGameMetadataInput): Promise<Game | null>;
  transitionStatus(id: string, from: GameStatus, to: GameStatus): Promise<Game | null>;
  delete(id: string): Promise<boolean>;
  listFavoriteAmounts(gameId: string): Promise<number[]>;
  toggleFavoriteAmount(gameId: string, amount: number): Promise<number[]>;
  listRecentAmounts(gameId: string): Promise<number[]>;
  recordRecentAmount(gameId: string, amount: number): Promise<void>;
}

export class D1GameRepository implements GameRepository {
  private readonly database: D1Database;

  constructor(database: D1Database) {
    this.database = database;
  }

  async createWithPlayers(input: CreateGameInput, players: CreatePlayerInput[]): Promise<void> {
    const gameStatement = this.database
      .prepare(
        `INSERT INTO games (id, name, starting_balance, pass_go_reward, currency, payment_mode, status, owner_user_id, join_code, game_access_password_hash, game_access_password_salt, board_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(input.id, input.name, input.startingBalance, input.passGoReward, input.currency, input.paymentMode ?? 'FAST', input.status ?? 'LOBBY', input.ownerUserId, input.joinCode, input.gameAccessPasswordHash, input.gameAccessPasswordSalt, input.board?.id ?? null);
    // A game with a board gets every ownership row and its building bank in the same batch as the game itself.
    const boardStatements = input.board === undefined ? [] : [
      ...input.board.spaceIds.map((spaceId) => this.database.prepare('INSERT INTO game_properties (game_id, board_space_id, board_id, owner_player_id, houses, mortgaged) VALUES (?, ?, ?, NULL, 0, 0)').bind(input.id, spaceId, input.board?.id ?? null)),
      this.database.prepare('INSERT INTO game_building_banks (game_id, houses_available, hotels_available) VALUES (?, ?, ?)').bind(input.id, input.board.houseBankLimit, input.board.hotelBankLimit),
    ];
    const playerStatements = players.map((player) =>
      this.database
        .prepare(
          `INSERT INTO players (id, game_id, name, color, balance)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(player.id, player.gameId, player.name, player.color, player.balance),
    );

    const ownerPlayerId = players[0]?.id;
    const memberStatement = this.database.prepare("INSERT INTO game_members (game_id, user_id, role, player_id) VALUES (?, ?, 'OWNER', ?)").bind(input.id, input.ownerUserId, ownerPlayerId ?? null);
    const controllerStatement = ownerPlayerId === undefined ? [] : [this.database.prepare("INSERT INTO player_controllers (game_id, player_id, user_id, controller_kind) VALUES (?, ?, ?, 'PRIMARY')").bind(input.id, ownerPlayerId, input.ownerUserId)];
    await this.database.batch([gameStatement, ...playerStatements, ...boardStatements, memberStatement, ...controllerStatement]);
  }

  async getById(id: string): Promise<Game | null> {
    const row = await this.database
      .prepare(
        `SELECT id, name, starting_balance, pass_go_reward, currency, payment_mode, status, created_at, updated_at, started_at, finished_at, board_id
         FROM games
         WHERE id = ?`,
      )
      .bind(id)
      .first<GameRow>();

    return row === null ? null : mapGame(row);
  }

  async list(): Promise<Game[]> {
    const result = await this.database
      .prepare(
        `SELECT id, name, starting_balance, pass_go_reward, currency, payment_mode, status, created_at, updated_at, started_at, finished_at, board_id
         FROM games
         ORDER BY updated_at DESC, id DESC`,
      )
      .all<GameRow>();

    return result.results.map(mapGame);
  }

  async listSummaries(): Promise<GameSummary[]> {
    const result = await this.database
      .prepare(
        `SELECT games.id, games.name, games.starting_balance, games.pass_go_reward, games.currency, games.payment_mode,
                games.status, games.created_at, games.updated_at, games.started_at, games.finished_at, games.board_id,
                COUNT(players.id) AS player_count
         FROM games
         LEFT JOIN players ON players.game_id = games.id
         GROUP BY games.id
         ORDER BY games.updated_at DESC, games.id DESC`,
      )
      .all<GameSummaryRow>();

    return result.results.map((row) => ({
      game: mapGame(row),
      playerCount: row.player_count,
    }));
  }

  async listSummariesForUser(userId: string): Promise<GameSummary[]> {
    const result = await this.database.prepare(
      `SELECT games.id, games.name, games.starting_balance, games.pass_go_reward, games.currency, games.payment_mode, games.status, games.created_at, games.updated_at, games.started_at, games.finished_at, games.board_id, COUNT(players.id) AS player_count,
              CASE WHEN game_members.user_id IS NULL AND games.status = 'LOBBY' AND games.game_access_password_hash IS NULL THEN 1 ELSE 0 END AS is_public_lobby,
              CASE WHEN game_members.user_id IS NULL AND games.status = 'LOBBY' AND games.game_access_password_hash IS NULL THEN games.join_code ELSE NULL END AS public_join_code
       FROM games LEFT JOIN game_members ON game_members.game_id = games.id AND game_members.user_id = ? LEFT JOIN players ON players.game_id = games.id
       WHERE games.owner_user_id IS NOT NULL AND (game_members.user_id IS NOT NULL OR (games.status = 'LOBBY' AND games.game_access_password_hash IS NULL))
       GROUP BY games.id ORDER BY games.updated_at DESC, games.id DESC`,
    ).bind(userId).all<GameSummaryRow>();
    return result.results.map((row) => ({ game: mapGame(row), playerCount: row.player_count, ...(row.is_public_lobby === 1 ? { isPublicLobby: true, joinCode: row.public_join_code ?? undefined } : {}) }));
  }

  async updateMetadata(input: UpdateGameMetadataInput): Promise<Game | null> {
    const assignments: string[] = [];
    const values: (string | GameStatus)[] = [];

    if (input.name !== undefined) {
      assignments.push('name = ?');
      values.push(input.name);
    }

    if (input.status !== undefined) {
      assignments.push('status = ?', "finished_at = CASE WHEN ? = 'FINISHED' THEN CURRENT_TIMESTAMP ELSE finished_at END");
      values.push(input.status === 'FINISHED' ? 'ARCHIVED' : input.status);
      values.push(input.status);
    }

    if (assignments.length === 0) {
      return this.getById(input.id);
    }

    assignments.push('updated_at = CURRENT_TIMESTAMP');
    values.push(input.id);

    const row = await this.database
      .prepare(
        `UPDATE games
         SET ${assignments.join(', ')}
         WHERE id = ?
         RETURNING id, name, starting_balance, pass_go_reward, currency, payment_mode, status, created_at, updated_at, started_at, finished_at, board_id`,
      )
      .bind(...values)
      .first<GameRow>();

    return row === null ? null : mapGame(row);
  }

  async transitionStatus(id: string, from: GameStatus, to: GameStatus): Promise<Game | null> {
    const storedFrom = from === 'FINISHED' ? 'ARCHIVED' : from;
    const storedTo = to === 'FINISHED' ? 'ARCHIVED' : to;
    const row = await this.database.prepare(
      `UPDATE games
       SET status = ?, updated_at = CURRENT_TIMESTAMP,
           started_at = CASE WHEN ? = 'ACTIVE' THEN CURRENT_TIMESTAMP ELSE started_at END,
           finished_at = CASE WHEN ? = 'ARCHIVED' THEN CURRENT_TIMESTAMP ELSE finished_at END
       WHERE id = ? AND status = ?
       RETURNING id, name, starting_balance, pass_go_reward, currency, payment_mode, status, created_at, updated_at, started_at, finished_at, board_id`,
    ).bind(storedTo, storedTo, storedTo, id, storedFrom).first<GameRow>();
    return row === null ? null : mapGame(row);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.database.prepare('DELETE FROM games WHERE id = ?').bind(id).run();
    return result.meta.changes > 0;
  }

  async listFavoriteAmounts(gameId: string): Promise<number[]> {
    const result = await this.database.prepare('SELECT amount FROM game_favorite_amounts WHERE game_id = ? ORDER BY created_at DESC, amount DESC').bind(gameId).all<{ amount: number }>();
    return result.results.map((row) => row.amount);
  }

  async toggleFavoriteAmount(gameId: string, amount: number): Promise<number[]> {
    const exists = await this.database.prepare('SELECT 1 AS value FROM game_favorite_amounts WHERE game_id = ? AND amount = ?').bind(gameId, amount).first<{ value: number }>();
    if (exists === null) {
      await this.database.prepare('INSERT INTO game_favorite_amounts (game_id, amount) VALUES (?, ?)').bind(gameId, amount).run();
    } else {
      await this.database.prepare('DELETE FROM game_favorite_amounts WHERE game_id = ? AND amount = ?').bind(gameId, amount).run();
    }
    return this.listFavoriteAmounts(gameId);
  }

  async listRecentAmounts(gameId: string): Promise<number[]> {
    const result = await this.database.prepare('SELECT amount FROM game_recent_amounts WHERE game_id = ? ORDER BY used_at DESC, amount DESC LIMIT 5').bind(gameId).all<{ amount: number }>();
    return result.results.map((row) => row.amount);
  }

  async recordRecentAmount(gameId: string, amount: number): Promise<void> {
    await this.database.batch([
      this.database.prepare('DELETE FROM game_recent_amounts WHERE game_id = ? AND amount = ?').bind(gameId, amount),
      this.database.prepare('INSERT INTO game_recent_amounts (game_id, amount, used_at) VALUES (?, ?, CURRENT_TIMESTAMP)').bind(gameId, amount),
      this.database.prepare('DELETE FROM game_recent_amounts WHERE game_id = ? AND amount NOT IN (SELECT amount FROM game_recent_amounts WHERE game_id = ? ORDER BY used_at DESC, amount DESC LIMIT 5)').bind(gameId, gameId),
    ]);
  }
}

interface GameSummaryRow extends GameRow {
  player_count: number;
  is_public_lobby?: number;
  public_join_code?: string | null;
}

function mapGame(row: GameRow): Game {
  return {
    id: row.id,
    name: row.name,
    startingBalance: row.starting_balance,
    passGoReward: row.pass_go_reward,
    currency: row.currency,
    paymentMode: row.payment_mode ?? 'FAST',
    status: row.status === 'ARCHIVED' ? 'FINISHED' : row.status === 'LOBBY' ? 'LOBBY' : 'ACTIVE',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    boardId: row.board_id ?? null,
  };
}
