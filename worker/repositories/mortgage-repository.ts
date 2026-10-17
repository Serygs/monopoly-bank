import type { Mortgage } from '../../shared/types/monopoly.js';

interface MortgageRow {
  id: string;
  game_id: string;
  player_id: string;
  property_name: string;
  tile_id: string | null;
  mortgage_value: number;
  created_at: string;
}

export interface MortgageRepository {
  /** The properties currently mortgaged in a game, oldest first. */
  listActive(gameId: string): Promise<Mortgage[]>;
  /** One active mortgage, or `null` when it does not exist, belongs to another game or is redeemed. */
  getActive(gameId: string, mortgageId: string): Promise<Mortgage | null>;
  /** The id of the mortgage a MORTGAGE_REDEMPTION transaction closed, or `null`. */
  findRedeemedBy(gameId: string, transactionId: string): Promise<string | null>;
}

const columns = 'id, game_id, player_id, property_name, tile_id, mortgage_value, created_at';

export class D1MortgageRepository implements MortgageRepository {
  private readonly database: D1Database;

  constructor(database: D1Database) {
    this.database = database;
  }

  async listActive(gameId: string): Promise<Mortgage[]> {
    const result = await this.database
      .prepare(
        `SELECT ${columns} FROM mortgages WHERE game_id = ? AND state = 'ACTIVE' ORDER BY created_at ASC, id ASC`,
      )
      .bind(gameId)
      .all<MortgageRow>();
    return result.results.map(mapMortgage);
  }

  async findRedeemedBy(gameId: string, transactionId: string): Promise<string | null> {
    const row = await this.database
      .prepare('SELECT id FROM mortgages WHERE game_id = ? AND redeemed_by_transaction_id = ?')
      .bind(gameId, transactionId)
      .first<{ id: string }>();
    return row?.id ?? null;
  }

  async getActive(gameId: string, mortgageId: string): Promise<Mortgage | null> {
    const row = await this.database
      .prepare(`SELECT ${columns} FROM mortgages WHERE game_id = ? AND id = ? AND state = 'ACTIVE'`)
      .bind(gameId, mortgageId)
      .first<MortgageRow>();
    return row === null ? null : mapMortgage(row);
  }
}

function mapMortgage(row: MortgageRow): Mortgage {
  return {
    id: row.id,
    gameId: row.game_id,
    playerId: row.player_id,
    propertyName: row.property_name,
    ...(row.tile_id == null ? {} : { tileId: row.tile_id }),
    mortgageValue: row.mortgage_value,
    createdAt: row.created_at,
  };
}
