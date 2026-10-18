import type { PersistBankingOperationInput } from '../banking-operation-repository.js';

export function registryStatements(
  database: D1Database,
  input: PersistBankingOperationInput,
): D1PreparedStatement[] {
  // Board games: each registry change is guarded by the state it read. A tile that moved on makes
  // the mortgaged flag -1, which breaks its CHECK and rolls the whole batch back (balances included).
  const registryStatements: D1PreparedStatement[] = [];
  for (const change of input.transaction.registryChanges ?? [])
    registryStatements.push(
      database
        .prepare(
          `UPDATE game_properties
             SET owner_player_id = ?1,
                 mortgaged = CASE WHEN owner_player_id IS ?2 AND mortgaged = ?3 AND houses = ?4 THEN ?5 ELSE -1 END,
                 houses = ?6
             WHERE game_id = ?7 AND tile_id = ?8`,
        )
        .bind(
          change.after.ownerPlayerId,
          change.before.ownerPlayerId,
          change.before.mortgaged ? 1 : 0,
          change.before.houses,
          change.after.mortgaged ? 1 : 0,
          change.after.houses,
          input.transaction.gameId,
          change.tileId,
        ),
      database
        .prepare(
          `INSERT INTO property_changes (transaction_id, game_id, tile_id, before_owner_player_id, before_mortgaged, before_houses, after_owner_player_id, after_mortgaged, after_houses)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          input.transactionId,
          input.transaction.gameId,
          change.tileId,
          change.before.ownerPlayerId,
          change.before.mortgaged ? 1 : 0,
          change.before.houses,
          change.after.ownerPlayerId,
          change.after.mortgaged ? 1 : 0,
          change.after.houses,
        ),
    );

  return registryStatements;
}
