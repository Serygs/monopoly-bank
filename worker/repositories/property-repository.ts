import type { GameProperty, PropertyChange } from '../../shared/types/monopoly.js';

interface PropertyRow {
  game_id: string;
  tile_id: string;
  owner_player_id: string | null;
  mortgaged: number;
  houses: number;
}

interface PropertyChangeRow {
  tile_id: string;
  before_owner_player_id: string | null;
  before_mortgaged: number;
  before_houses: number;
  after_owner_player_id: string | null;
  after_mortgaged: number;
  after_houses: number;
}

export interface PropertyRepository {
  /** The registry changes stored with one transaction, in tile id order. */
  listChanges(gameId: string, transactionId: string): Promise<PropertyChange[]>;
  /** The per-game state of every board property (owner, mortgage, houses), in tile id order. */
  listByGame(gameId: string): Promise<GameProperty[]>;
}

export class D1PropertyRepository implements PropertyRepository {
  private readonly database: D1Database;

  constructor(database: D1Database) {
    this.database = database;
  }

  async listChanges(gameId: string, transactionId: string): Promise<PropertyChange[]> {
    const result = await this.database
      .prepare(
        `SELECT tile_id, before_owner_player_id, before_mortgaged, before_houses,
                after_owner_player_id, after_mortgaged, after_houses
         FROM property_changes WHERE game_id = ? AND transaction_id = ? ORDER BY tile_id ASC`,
      )
      .bind(gameId, transactionId)
      .all<PropertyChangeRow>();
    return result.results.map((row) => ({
      tileId: row.tile_id,
      before: {
        ownerPlayerId: row.before_owner_player_id,
        mortgaged: row.before_mortgaged === 1,
        houses: row.before_houses,
      },
      after: {
        ownerPlayerId: row.after_owner_player_id,
        mortgaged: row.after_mortgaged === 1,
        houses: row.after_houses,
      },
    }));
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
