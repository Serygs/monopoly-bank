import type { PersistBankingOperationInput } from '../banking-operation-repository.js';

export function newLoanStatements(
  database: D1Database,
  input: PersistBankingOperationInput,
): D1PreparedStatement[] {
  // A repayment lowers the debt in the same batch. Repaying a loan that is no longer active, that
  // changed lender, or by more than is owed turns into a CHECK failure and rolls everything back.
  const statements: D1PreparedStatement[] = [];
  const { newLoan } = input.transaction;
  if (newLoan !== undefined)
    statements.push(
      database
        .prepare(
          `INSERT INTO loans (id, game_id, lender_kind, lender_player_id, borrower_player_id, principal, cooldown_acknowledged)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          input.transactionId,
          input.transaction.gameId,
          newLoan.lenderKind ?? 'PLAYER',
          newLoan.lenderPlayerId,
          newLoan.borrowerPlayerId,
          newLoan.principal,
          newLoan.cooldownAcknowledged === true ? 1 : 0,
        ),
    );
  return statements;
}

export function loanRepaymentStatements(
  database: D1Database,
  input: PersistBankingOperationInput,
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  const { loanRepayment } = input.transaction;
  if (loanRepayment !== undefined) {
    statements.push(
      database
        .prepare(
          `UPDATE loans
             SET repaid_amount = repaid_amount + ?1,
                 state = CASE
                   WHEN state <> 'ACTIVE' OR lender_player_id IS NOT ?4 OR borrower_player_id IS NOT ?5 THEN 'NOT_ACTIVE'
                   WHEN repaid_amount + ?1 = principal THEN 'REPAID'
                   ELSE 'ACTIVE' END,
                 closed_at = CASE WHEN state = 'ACTIVE' AND repaid_amount + ?1 = principal THEN CURRENT_TIMESTAMP ELSE closed_at END
             WHERE id = ?2 AND game_id = ?3`,
        )
        .bind(
          loanRepayment.amount,
          loanRepayment.loanId,
          input.transaction.gameId,
          loanRepayment.lenderPlayerId,
          loanRepayment.borrowerPlayerId,
        ),
      database
        .prepare(
          `INSERT INTO loan_repayments (transaction_id, game_id, loan_id, amount, interest_amount, interest_rate_percent, suggested_rate_percent)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          input.transactionId,
          input.transaction.gameId,
          loanRepayment.loanId,
          loanRepayment.amount,
          loanRepayment.interestAmount ?? 0,
          loanRepayment.interestRatePercent ?? null,
          loanRepayment.suggestedRatePercent ?? null,
        ),
    );
  }

  return statements;
}

export function loanStatements(
  database: D1Database,
  input: PersistBankingOperationInput,
): D1PreparedStatement[] {
  return [...newLoanStatements(database, input), ...loanRepaymentStatements(database, input)];
}
