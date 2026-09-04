import type { GameSummary } from '../../shared/contracts/api.js';
import type { Currency, Game, GameStatus } from '../../shared/types/monopoly.js';
import type { CreatePlayerInput } from './player-repository.js';

interface GameRow {
  id: string;
  name: string;
  starting_balance: number;
  pass_go_reward: number;
  currency: Currency;
  status: string;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface CreateGameInput {
  id: string;
  name: string;
  startingBalance: number;
  passGoReward: number;
  currency: Currency;
  status?: GameStatus;
  ownerUserId: string;
  joinCode: string;
  gameAccessPasswordHash: string;
  gameAccessPasswordSalt: string;
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
        `INSERT INTO games (id, name, starting_balance, pass_go_reward, currency, status, owner_user_id, join_code, game_access_password_hash, game_access_password_salt, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      )
      .bind(input.id, input.name, input.startingBalance, input.passGoReward, input.currency, input.status ?? 'ACTIVE', input.ownerUserId, input.joinCode, input.gameAccessPasswordHash, input.gameAccessPasswordSalt);
    const playerStatements = players.map((player) =>
      this.database
        .prepare(
          `INSERT INTO players (id, game_id, name, color, balance)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(player.id, player.gameId, player.name, player.color, player.balance),
    );

    const memberStatement = [this.database.prepare("INSERT INTO game_members (game_id, user_id, role, player_id) VALUES (?, ?, 'OWNER', ?)").bind(input.id, input.ownerUserId, players[0]?.id ?? null)];
    await this.database.batch([gameStatement, ...playerStatements, ...memberStatement]);
  }

  async getById(id: string): Promise<Game | null> {
    const row = await this.database
      .prepare(
        `SELECT id, name, starting_balance, pass_go_reward, currency, status, created_at, updated_at, started_at, finished_at
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
        `SELECT id, name, starting_balance, pass_go_reward, currency, status, created_at, updated_at, started_at, finished_at
         FROM games
         ORDER BY updated_at DESC, id DESC`,
      )
      .all<GameRow>();

    return result.results.map(mapGame);
  }

  async listSummaries(): Promise<GameSummary[]> {
    const result = await this.database
      .prepare(
        `SELECT games.id, games.name, games.starting_balance, games.pass_go_reward, games.currency,
                games.status, games.created_at, games.updated_at, games.started_at, games.finished_at,
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
      `SELECT games.id, games.name, games.starting_balance, games.pass_go_reward, games.currency, games.status, games.created_at, games.updated_at, games.started_at, games.finished_at, COUNT(players.id) AS player_count
       FROM games INNER JOIN game_members ON game_members.game_id = games.id LEFT JOIN players ON players.game_id = games.id
       WHERE game_members.user_id = ? AND games.owner_user_id IS NOT NULL GROUP BY games.id ORDER BY games.updated_at DESC, games.id DESC`,
    ).bind(userId).all<GameSummaryRow>();
    return result.results.map((row) => ({ game: mapGame(row), playerCount: row.player_count }));
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
         RETURNING id, name, starting_balance, pass_go_reward, currency, status, created_at, updated_at, started_at, finished_at`,
      )
      .bind(...values)
      .first<GameRow>();

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
}

function mapGame(row: GameRow): Game {
  return {
    id: row.id,
    name: row.name,
    startingBalance: row.starting_balance,
    passGoReward: row.pass_go_reward,
    currency: row.currency,
    status: row.status === 'ARCHIVED' ? 'FINISHED' : 'ACTIVE',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}
