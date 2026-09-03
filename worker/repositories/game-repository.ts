import type { GameSummary } from '../../shared/contracts/api.js';
import type { Game, GameStatus } from '../../shared/types/monopoly.js';
import type { CreatePlayerInput } from './player-repository.js';

interface GameRow {
  id: string;
  name: string;
  starting_balance: number;
  pass_go_reward: number;
  status: GameStatus;
  created_at: string;
  updated_at: string;
}

export interface CreateGameInput {
  id: string;
  name: string;
  startingBalance: number;
  passGoReward: number;
  status?: GameStatus;
}

export interface UpdateGameMetadataInput {
  id: string;
  name?: string;
  status?: GameStatus;
}

export interface GameRepository {
  create(input: CreateGameInput): Promise<Game>;
  createWithPlayers(input: CreateGameInput, players: CreatePlayerInput[]): Promise<void>;
  getById(id: string): Promise<Game | null>;
  list(): Promise<Game[]>;
  listSummaries(): Promise<GameSummary[]>;
  updateMetadata(input: UpdateGameMetadataInput): Promise<Game | null>;
  delete(id: string): Promise<boolean>;
}

export class D1GameRepository implements GameRepository {
  private readonly database: D1Database;

  constructor(database: D1Database) {
    this.database = database;
  }

  async create(input: CreateGameInput): Promise<Game> {
    const row = await this.database
      .prepare(
        `INSERT INTO games (id, name, starting_balance, pass_go_reward, status)
         VALUES (?, ?, ?, ?, ?)
         RETURNING id, name, starting_balance, pass_go_reward, status, created_at, updated_at`,
      )
      .bind(
        input.id,
        input.name,
        input.startingBalance,
        input.passGoReward,
        input.status ?? 'ACTIVE',
      )
      .first<GameRow>();

    if (row === null) {
      throw new Error('D1 did not return the created game.');
    }

    return mapGame(row);
  }

  async createWithPlayers(input: CreateGameInput, players: CreatePlayerInput[]): Promise<void> {
    const gameStatement = this.database
      .prepare(
        `INSERT INTO games (id, name, starting_balance, pass_go_reward, status)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(input.id, input.name, input.startingBalance, input.passGoReward, input.status ?? 'ACTIVE');
    const playerStatements = players.map((player) =>
      this.database
        .prepare(
          `INSERT INTO players (id, game_id, name, color, balance)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(player.id, player.gameId, player.name, player.color, player.balance),
    );

    await this.database.batch([gameStatement, ...playerStatements]);
  }

  async getById(id: string): Promise<Game | null> {
    const row = await this.database
      .prepare(
        `SELECT id, name, starting_balance, pass_go_reward, status, created_at, updated_at
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
        `SELECT id, name, starting_balance, pass_go_reward, status, created_at, updated_at
         FROM games
         ORDER BY updated_at DESC, id DESC`,
      )
      .all<GameRow>();

    return result.results.map(mapGame);
  }

  async listSummaries(): Promise<GameSummary[]> {
    const result = await this.database
      .prepare(
        `SELECT games.id, games.name, games.starting_balance, games.pass_go_reward,
                games.status, games.created_at, games.updated_at,
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

  async updateMetadata(input: UpdateGameMetadataInput): Promise<Game | null> {
    const assignments: string[] = [];
    const values: (string | GameStatus)[] = [];

    if (input.name !== undefined) {
      assignments.push('name = ?');
      values.push(input.name);
    }

    if (input.status !== undefined) {
      assignments.push('status = ?');
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
         RETURNING id, name, starting_balance, pass_go_reward, status, created_at, updated_at`,
      )
      .bind(...values)
      .first<GameRow>();

    return row === null ? null : mapGame(row);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.database.prepare('DELETE FROM games WHERE id = ?').bind(id).run();
    return result.meta.changes > 0;
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
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
