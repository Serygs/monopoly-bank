import type { Player } from '../../shared/types/monopoly.js';

interface PlayerRow {
  id: string;
  game_id: string;
  name: string;
  color: string;
  balance: number;
  created_at: string;
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
        `SELECT id, game_id, name, color, balance, created_at
         FROM players
         WHERE game_id = ?
         ORDER BY created_at ASC, id ASC`,
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
}

function mapPlayer(row: PlayerRow): Player {
  return {
    id: row.id,
    gameId: row.game_id,
    name: row.name,
    color: row.color,
    balance: row.balance,
    createdAt: row.created_at,
  };
}
