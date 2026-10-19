import type { PropertyChange } from '../../../shared/types/monopoly.js';
import type { PersistBankingOperationInput } from '../banking-operation-repository.js';

export function registryStatements(
  database: D1Database,
  input: PersistBankingOperationInput,
): D1PreparedStatement[] {
  return (input.transaction.registryChanges ?? []).flatMap((change) =>
    registryChangeStatements(database, input, change),
  );
}

function registryChangeStatements(
  database: D1Database,
  input: PersistBankingOperationInput,
  change: PropertyChange,
): D1PreparedStatement[] {
  return [
    registryGuardStatement(database, input, change),
    propertyChangeStatement(database, input, change),
  ];
}

function registryGuardStatement(
  database: D1Database,
  input: PersistBankingOperationInput,
  change: PropertyChange,
): D1PreparedStatement {
  return database
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
    );
}

function propertyChangeStatement(
  database: D1Database,
  input: PersistBankingOperationInput,
  change: PropertyChange,
): D1PreparedStatement {
  return database
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
    );
}
