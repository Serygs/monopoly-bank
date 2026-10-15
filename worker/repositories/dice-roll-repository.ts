import type { DiceRoll } from '../../shared/contracts/api.js';

interface DiceRollRow {
  id: string;
  player_id: string;
  die_one: number;
  die_two: number;
  created_at: string;
}

/** A player keeps this many rolls while the game runs; older ones are dropped on insert. */
export const diceRollsKeptPerPlayer = 100;

export interface DiceRollRepository {
  /** Idempotent by roll id; returns the stored roll, or null if the id belongs to another player. */
  record(input: {
    id: string;
    gameId: string;
    playerId: string;
    dieOne: number;
    dieTwo: number;
  }): Promise<DiceRoll | null>;
  listForPlayer(gameId: string, playerId: string, limit: number): Promise<DiceRoll[]>;
}

export class D1DiceRollRepository implements DiceRollRepository {
  private readonly database: D1Database;
  constructor(database: D1Database) {
    this.database = database;
  }

  async record(input: {
    id: string;
    gameId: string;
    playerId: string;
    dieOne: number;
    dieTwo: number;
  }): Promise<DiceRoll | null> {
    await this.database.batch([
      this.database
        .prepare(
          `INSERT INTO dice_rolls (id, game_id, player_id, die_one, die_two)
           VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
        )
        .bind(input.id, input.gameId, input.playerId, input.dieOne, input.dieTwo),
      this.database
        .prepare(
          `DELETE FROM dice_rolls
           WHERE game_id = ? AND player_id = ? AND id NOT IN (
             SELECT id FROM dice_rolls WHERE game_id = ? AND player_id = ?
             ORDER BY created_at DESC, rowid DESC LIMIT ?
           )`,
        )
        .bind(input.gameId, input.playerId, input.gameId, input.playerId, diceRollsKeptPerPlayer),
    ]);
    const row = await this.database
      .prepare(
        `SELECT id, player_id, die_one, die_two, created_at FROM dice_rolls
         WHERE id = ? AND game_id = ? AND player_id = ?`,
      )
      .bind(input.id, input.gameId, input.playerId)
      .first<DiceRollRow>();
    return row === null ? null : toDiceRoll(row);
  }

  async listForPlayer(gameId: string, playerId: string, limit: number): Promise<DiceRoll[]> {
    const result = await this.database
      .prepare(
        `SELECT id, player_id, die_one, die_two, created_at FROM dice_rolls
         WHERE game_id = ? AND player_id = ?
         ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      )
      .bind(gameId, playerId, limit)
      .all<DiceRollRow>();
    return result.results.map(toDiceRoll);
  }
}

function toDiceRoll(row: DiceRollRow): DiceRoll {
  return {
    id: row.id,
    playerId: row.player_id,
    dieOne: row.die_one,
    dieTwo: row.die_two,
    createdAt: row.created_at,
  };
}
