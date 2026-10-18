import type { PersistBankingOperationInput } from '../banking-operation-repository.js';

export function jackpotStatements(
  database: D1Database,
  input: PersistBankingOperationInput,
): D1PreparedStatement[] {
  // The pot changes only here, with its own transaction. A payout is guarded by the pot it read:
  // if the pot changed since, the -1 breaks the CHECK (jackpot_balance >= 0) and rolls everything back.
  const jackpotStatements: D1PreparedStatement[] = [];
  const { jackpot } = input.transaction;
  if (jackpot?.kind === 'DEPOSIT')
    jackpotStatements.push(
      database
        .prepare('UPDATE games SET jackpot_balance = jackpot_balance + ? WHERE id = ?')
        .bind(jackpot.amount, input.transaction.gameId),
    );
  if (jackpot?.kind === 'COLLECT')
    jackpotStatements.push(
      database
        .prepare(
          'UPDATE games SET jackpot_balance = CASE WHEN jackpot_balance = ? THEN 0 ELSE -1 END WHERE id = ?',
        )
        .bind(jackpot.expected, input.transaction.gameId),
    );

  return jackpotStatements;
}
