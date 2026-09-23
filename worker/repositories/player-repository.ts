import type { Player, PlayerStatus } from '../../shared/types/monopoly.js';

interface PlayerRow {
  id: string;
  game_id: string;
  name: string;
  color: string;
  balance: number;
  status: PlayerStatus;
  is_in_jail: number;
  consecutive_doubles: number;
  last_roll_total?: number | null;
  last_roll_at?: string | null;
  user_id: string | null;
  created_at: string;
}

export interface UpdateGameplayStateInput {
  status?: PlayerStatus;
  isInJail?: boolean;
  consecutiveDoubles?: number;
  lastRollTotal?: number | null;
  lastRollAt?: string | null;
}

export interface CreatePlayerInput {
  id: string;
  gameId: string;
  name: string;
  color: string;
  balance: number;
}

export interface PlayerRepository {
  createMany(inputs: CreatePlayerInput[]): Promise<Player[]>;
  listByGameId(gameId: string): Promise<Player[]>;
  updateBalance(playerId: string, balance: number): Promise<boolean>;
  updateGameplayState(playerId: string, input: UpdateGameplayStateInput): Promise<Player | null>;
}

export class D1PlayerRepository implements PlayerRepository {
  private readonly database: D1Database;

  constructor(database: D1Database) {
    this.database = database;
  }

  async createMany(inputs: CreatePlayerInput[]): Promise<Player[]> {
    if (inputs.length === 0) {
      return [];
    }

    const gameId = inputs[0].gameId;
    if (inputs.some((input) => input.gameId !== gameId)) {
      throw new Error('Players created together must belong to the same game.');
    }

    const statements = inputs.map((input) =>
      this.database
        .prepare(
          `INSERT INTO players (id, game_id, name, color, balance)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(input.id, input.gameId, input.name, input.color, input.balance),
    );

    await this.database.batch(statements);
    return this.listByGameId(gameId);
  }

  async listByGameId(gameId: string): Promise<Player[]> {
    const result = await this.database
      .prepare(
        `SELECT players.id, players.game_id, players.name, players.color, players.balance, players.status, players.is_in_jail, players.consecutive_doubles, players.last_roll_total, players.last_roll_at, players.created_at, game_members.user_id
         FROM players LEFT JOIN game_members ON game_members.player_id = players.id AND game_members.game_id = players.game_id
         WHERE players.game_id = ?
         ORDER BY players.created_at ASC, players.id ASC`,
      )
      .bind(gameId)
      .all<PlayerRow>();

    return result.results.map(mapPlayer);
  }

  async updateBalance(playerId: string, balance: number): Promise<boolean> {
    const result = await this.database
      .prepare(
        `UPDATE players
         SET balance = ?
         WHERE id = ? AND ? >= 0`,
      )
      .bind(balance, playerId, balance)
      .run();

    return result.meta.changes > 0;
  }

  async updateGameplayState(playerId: string, input: UpdateGameplayStateInput): Promise<Player | null> {
    const assignments: string[] = [];
    const values: (string | number | null)[] = [];
    if (input.status !== undefined) { assignments.push('status = ?'); values.push(input.status); }
    if (input.isInJail !== undefined) { assignments.push('is_in_jail = ?'); values.push(input.isInJail ? 1 : 0); }
    if (input.consecutiveDoubles !== undefined) { assignments.push('consecutive_doubles = ?'); values.push(input.consecutiveDoubles); }
    if (input.lastRollTotal !== undefined) { assignments.push('last_roll_total = ?'); values.push(input.lastRollTotal); }
    if (input.lastRollAt !== undefined) { assignments.push('last_roll_at = ?'); values.push(input.lastRollAt); }
    if (assignments.length === 0) return null;
    const row = await this.database.prepare(`UPDATE players SET ${assignments.join(', ')} WHERE id = ? RETURNING id, game_id, name, color, balance, status, is_in_jail, consecutive_doubles, last_roll_total, last_roll_at, created_at, NULL AS user_id`).bind(...values, playerId).first<PlayerRow>();
    return row === null ? null : mapPlayer(row);
  }
}

function mapPlayer(row: PlayerRow): Player {
  return {
    id: row.id,
    gameId: row.game_id,
    name: row.name,
    color: row.color,
    balance: row.balance,
    status: row.status,
    isInJail: row.is_in_jail === 1,
    consecutiveDoubles: row.consecutive_doubles,
    lastRollTotal: row.last_roll_total ?? null,
    lastRollAt: row.last_roll_at ?? null,
    userId: row.user_id,
    createdAt: row.created_at,
  };
}
