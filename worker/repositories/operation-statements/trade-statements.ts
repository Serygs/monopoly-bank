import type { PersistBankingOperationInput } from '../banking-operation-repository.js';

export function acceptedTradeStatements(
  database: D1Database,
  input: PersistBankingOperationInput,
): D1PreparedStatement[] {
  const tradeRequestStatements =
    input.acceptTradeRequestId === undefined
      ? []
      : [
          database
            .prepare(
              `UPDATE trade_requests SET
                   state = CASE WHEN state = 'PENDING' AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now') THEN 'ACCEPTED' ELSE 'NOT_PENDING' END,
                   resolved_at = CURRENT_TIMESTAMP, transaction_id = ?
                 WHERE id = ? AND game_id = ?`,
            )
            .bind(input.transactionId, input.acceptTradeRequestId, input.transaction.gameId),
        ];
  return tradeRequestStatements;
}

export function bankruptTradeStatements(
  database: D1Database,
  input: PersistBankingOperationInput,
): D1PreparedStatement[] {
  // A bankrupt player's pending trades can never be accepted: cancelled in the bankruptcy's batch.
  const statements =
    input.bankruptPlayerId === undefined
      ? []
      : [
          database
            .prepare(
              `UPDATE trade_requests SET state = 'CANCELLED', resolved_at = CURRENT_TIMESTAMP
                 WHERE game_id = ? AND state = 'PENDING' AND (proposer_player_id = ? OR counterparty_player_id = ?)`,
            )
            .bind(input.transaction.gameId, input.bankruptPlayerId, input.bankruptPlayerId),
        ];

  return statements;
}
