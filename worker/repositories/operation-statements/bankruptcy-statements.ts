import type { PersistBankingOperationInput } from '../banking-operation-repository.js';

export function bankruptStatusStatements(
  database: D1Database,
  input: PersistBankingOperationInput,
): D1PreparedStatement[] {
  const statements =
    input.bankruptPlayerId === undefined
      ? []
      : [
          database
            .prepare(
              "UPDATE players SET status = 'BANKRUPT', balance = 0 WHERE id = ? AND game_id = ? AND status = 'ACTIVE'",
            )
            .bind(input.bankruptPlayerId, input.transaction.gameId),
        ];
  return statements;
}

export function bankruptMortgageStatements(
  database: D1Database,
  input: PersistBankingOperationInput,
): D1PreparedStatement[] {
  // A bankrupt player's mortgages go to the creditor so they can be redeemed; one the creditor
  // already has under the same name is skipped by OR IGNORE and, like every mortgage of a
  // bankruptcy to the bank, is released.
  const statements: D1PreparedStatement[] = [];
  if (input.bankruptPlayerId !== undefined) {
    if (input.mortgageHeirPlayerId != null)
      statements.push(
        database
          .prepare(
            `UPDATE OR IGNORE mortgages SET player_id = ?
               WHERE game_id = ? AND player_id = ? AND state = 'ACTIVE'`,
          )
          .bind(input.mortgageHeirPlayerId, input.transaction.gameId, input.bankruptPlayerId),
      );
    statements.push(
      database
        .prepare(
          `UPDATE mortgages SET state = 'RELEASED'
             WHERE game_id = ? AND player_id = ? AND state = 'ACTIVE'`,
        )
        .bind(input.transaction.gameId, input.bankruptPlayerId),
    );
  }
  return statements;
}

export function bankLoanSettlementStatements(
  database: D1Database,
  input: PersistBankingOperationInput,
): D1PreparedStatement[] {
  if (input.bankruptPlayerId === undefined) return [];
  const statements: D1PreparedStatement[] = [];
  // The bank took its share of the wallet first. A loan that is no longer active, or whose
  // principal does not match how it ended, turns into a CHECK failure and rolls everything back.
  const settlement = input.transaction.bankLoanSettlement;
  if (settlement !== undefined && settlement.paidPrincipal > 0)
    statements.push(
      database
        .prepare(
          `UPDATE loans
               SET repaid_amount = repaid_amount + ?1,
                   state = CASE
                     WHEN state <> 'ACTIVE' OR lender_kind <> 'BANK' OR borrower_player_id <> ?4 THEN 'NOT_ACTIVE'
                     WHEN ?5 = 'REPAID' THEN 'REPAID'
                     ELSE 'WRITTEN_OFF' END,
                   closed_at = CURRENT_TIMESTAMP
               WHERE id = ?2 AND game_id = ?3`,
        )
        .bind(
          settlement.paidPrincipal,
          settlement.loanId,
          input.transaction.gameId,
          settlement.borrowerPlayerId,
          settlement.outcome,
        ),
      database
        .prepare(
          `INSERT INTO loan_repayments (transaction_id, game_id, loan_id, amount, interest_amount, interest_rate_percent, suggested_rate_percent)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          input.transactionId,
          input.transaction.gameId,
          settlement.loanId,
          settlement.paidPrincipal,
          settlement.paidInterest,
          settlement.interestRatePercent,
          settlement.suggestedRatePercent,
        ),
    );
  return statements;
}

export function bankruptDebtStatements(
  database: D1Database,
  input: PersistBankingOperationInput,
): D1PreparedStatement[] {
  // A bankrupt player's debts are forgiven; the loans they made go to the creditor, unless the
  // creditor is the borrower (nobody lends to themselves) or the bankruptcy is to the bank.
  if (input.bankruptPlayerId === undefined) return [];
  const statements: D1PreparedStatement[] = [];
  const gameId = input.transaction.gameId;
  statements.push(
    database
      .prepare(
        `UPDATE loans SET state = 'WRITTEN_OFF', closed_at = CURRENT_TIMESTAMP
             WHERE game_id = ? AND borrower_player_id = ? AND state = 'ACTIVE'`,
      )
      .bind(gameId, input.bankruptPlayerId),
  );
  if (input.loanHeirPlayerId != null)
    statements.push(
      database
        .prepare(
          `UPDATE loans SET lender_player_id = ?
               WHERE game_id = ? AND lender_player_id = ? AND borrower_player_id <> ? AND state = 'ACTIVE'`,
        )
        .bind(input.loanHeirPlayerId, gameId, input.bankruptPlayerId, input.loanHeirPlayerId),
    );
  statements.push(
    database
      .prepare(
        `UPDATE loans SET state = 'WRITTEN_OFF', closed_at = CURRENT_TIMESTAMP
             WHERE game_id = ? AND lender_player_id = ? AND state = 'ACTIVE'`,
      )
      .bind(gameId, input.bankruptPlayerId),
  );
  return statements;
}

export function bankruptcyStatements(
  database: D1Database,
  input: PersistBankingOperationInput,
): D1PreparedStatement[] {
  return [
    ...bankruptStatusStatements(database, input),
    ...bankruptMortgageStatements(database, input),
    ...bankLoanSettlementStatements(database, input),
    ...bankruptDebtStatements(database, input),
  ];
}
