import type { PersistBankingOperationInput } from '../banking-operation-repository.js';

export function transactionStatements(
  database: D1Database,
  input: PersistBankingOperationInput,
): D1PreparedStatement[] {
  const transactionStatement = database
    .prepare(
      `INSERT INTO transactions (id, game_id, type, amount, total_amount, comment, reverses_transaction_id, tile_id, price_overridden, initiator_player_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.transactionId,
      input.transaction.gameId,
      input.transaction.type,
      input.transaction.amount,
      input.transaction.totalAmount,
      input.transaction.comment,
      input.transaction.reversesTransactionId ?? null,
      input.transaction.tileId ?? null,
      input.transaction.priceOverridden === true ? 1 : 0,
      input.transaction.initiatorPlayerId ?? null,
    );
  const participantStatements = input.transaction.participants.map((participant) =>
    database
      .prepare(
        `INSERT INTO transaction_participants (transaction_id, game_id, player_id, balance_delta)
           VALUES (?, ?, ?, ?)`,
      )
      .bind(
        input.transactionId,
        input.transaction.gameId,
        participant.playerId,
        participant.balanceDelta,
      ),
  );

  return [transactionStatement, ...participantStatements];
}
