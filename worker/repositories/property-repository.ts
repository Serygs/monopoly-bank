import type { GameProperty } from '../../shared/types/monopoly.js';

interface PropertyRow {
  game_id: string;
  tile_id: string;
  owner_player_id: string | null;
  mortgaged: number;
  houses: number;
}

export interface PropertyRepository {
  /** The per-game state of every board property (owner, mortgage, houses), in tile id order. */
  listByGame(gameId: string): Promise<GameProperty[]>;
}

export class D1PropertyRepository implements PropertyRepository {
  private readonly database: D1Database;

  constructor(database: D1Database) {
    this.database = database;
  }

  async listByGame(gameId: string): Promise<GameProperty[]> {
    const result = await this.database
      .prepare(
        'SELECT game_id, tile_id, owner_player_id, mortgaged, houses FROM game_properties WHERE game_id = ? ORDER BY tile_id ASC',
      )
      .bind(gameId)
      .all<PropertyRow>();
    return result.results.map((row) => ({
      gameId: row.game_id,
      tileId: row.tile_id,
      ownerPlayerId: row.owner_player_id,
      mortgaged: row.mortgaged === 1,
      houses: row.houses,
    }));
  }
}
