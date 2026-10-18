import { propertyNameKey } from '../../../shared/domain/mortgage.js';
import type { PersistBankingOperationInput } from '../banking-operation-repository.js';

export function mortgageRecordStatements(
  database: D1Database,
  input: PersistBankingOperationInput,
): D1PreparedStatement[] {
  // The mortgage record is written in the same batch as its transaction. Redeeming one that is
  // no longer active turns into a CHECK failure, which rolls the whole batch back.
  const statements: D1PreparedStatement[] = [];
  const { newMortgage, redeemedMortgageId } = input.transaction;
  if (newMortgage !== undefined)
    statements.push(
      database
        .prepare(
          `INSERT INTO mortgages (id, game_id, player_id, property_name, name_key, mortgage_value, tile_id)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          input.transactionId,
          input.transaction.gameId,
          newMortgage.playerId,
          newMortgage.propertyName,
          propertyNameKey(newMortgage.propertyName),
          newMortgage.mortgageValue,
          newMortgage.tileId ?? null,
        ),
    );
  if (redeemedMortgageId !== undefined)
    statements.push(
      database
        .prepare(
          `UPDATE mortgages
             SET state = CASE WHEN state = 'ACTIVE' THEN 'REDEEMED' ELSE 'NOT_ACTIVE' END,
                 redeemed_by_transaction_id = ?, redeemed_at = CURRENT_TIMESTAMP
             WHERE id = ? AND game_id = ?`,
        )
        .bind(input.transactionId, redeemedMortgageId, input.transaction.gameId),
    );

  return statements;
}

export function mortgageReversalStatements(
  database: D1Database,
  input: PersistBankingOperationInput,
): D1PreparedStatement[] {
  // Reversing a board mortgage keeps its row in step. A row that is no longer in the state the
  // original left it in turns into a CHECK failure and rolls the whole batch back.
  const statements: D1PreparedStatement[] = [];
  const { mortgageReversal } = input.transaction;
  if (mortgageReversal?.kind === 'CANCEL')
    statements.push(
      database
        .prepare(
          `UPDATE mortgages
             SET state = CASE WHEN state = 'ACTIVE' THEN 'RELEASED' ELSE 'NOT_ACTIVE' END
             WHERE id = ? AND game_id = ?`,
        )
        .bind(mortgageReversal.mortgageId, input.transaction.gameId),
    );
  if (mortgageReversal?.kind === 'RESTORE')
    statements.push(
      database
        .prepare(
          `UPDATE mortgages
             SET state = CASE WHEN state = 'REDEEMED' THEN 'ACTIVE' ELSE 'NOT_ACTIVE' END,
                 redeemed_by_transaction_id = NULL, redeemed_at = NULL
             WHERE id = ? AND game_id = ?`,
        )
        .bind(mortgageReversal.mortgageId, input.transaction.gameId),
    );

  return statements;
}

export function mortgageHandoverStatements(
  database: D1Database,
  input: PersistBankingOperationInput,
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  // A mortgaged tile that changes hands (a trade, or the reversal of one) keeps its mortgage, which
  // follows the tile to the new owner so they can redeem it. The registry guard below decides
  // whether the whole batch applies. A bankruptcy moves its mortgages itself.
  if (input.bankruptPlayerId === undefined)
    for (const change of input.transaction.registryChanges ?? [])
      if (
        change.before.mortgaged &&
        change.after.mortgaged &&
        change.after.ownerPlayerId !== null &&
        change.after.ownerPlayerId !== change.before.ownerPlayerId
      )
        statements.push(
          database
            .prepare(
              `UPDATE mortgages SET player_id = ?
                 WHERE game_id = ? AND tile_id = ? AND state = 'ACTIVE'`,
            )
            .bind(change.after.ownerPlayerId, input.transaction.gameId, change.tileId),
        );

  return statements;
}

export function mortgageStatements(
  database: D1Database,
  input: PersistBankingOperationInput,
): D1PreparedStatement[] {
  return [
    ...mortgageRecordStatements(database, input),
    ...mortgageReversalStatements(database, input),
    ...mortgageHandoverStatements(database, input),
  ];
}
