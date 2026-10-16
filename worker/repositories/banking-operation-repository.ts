import type { PlayerBalanceChange, PendingTransaction } from '../../shared/domain/banking.js';
import { propertyNameKey } from '../../shared/domain/mortgage.js';
import { DatabaseError } from '../services/errors.js';

export interface PersistBankingOperationInput {
  transactionId: string;
  transaction: PendingTransaction;
  balanceChanges: readonly PlayerBalanceChange[];
  bankruptPlayerId?: string;
  /**
   * With a bankruptcy: the player who takes over the bankrupt player's mortgages (the creditor).
   * Without one the mortgages are released, as the properties went back to the bank.
   */
  mortgageHeirPlayerId?: string | null;
  /**
   * With a bankruptcy: the player who takes over the loans the bankrupt player made (the
   * creditor). Without one every such loan is written off. Loans the bankrupt player owes are
   * always written off.
   */
  loanHeirPlayerId?: string | null;
  recentAmount?: number;
}

export interface BankingOperationRepository {
  persist(input: PersistBankingOperationInput): Promise<void>;
}

export class D1BankingOperationRepository implements BankingOperationRepository {
  private readonly database: D1Database;

  constructor(database: D1Database) {
    this.database = database;
  }

  async persist(input: PersistBankingOperationInput): Promise<void> {
    const balanceStatement = createBalanceUpdateStatement(this.database, input.balanceChanges);
    const transactionStatement = this.database
      .prepare(
        `INSERT INTO transactions (id, game_id, type, amount, total_amount, comment, reverses_transaction_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.transactionId,
        input.transaction.gameId,
        input.transaction.type,
        input.transaction.amount,
        input.transaction.totalAmount,
        input.transaction.comment,
        input.transaction.reversesTransactionId ?? null,
      );
    const participantStatements = input.transaction.participants.map((participant) =>
      this.database
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

    // The mortgage record is written in the same batch as its transaction. Redeeming one that is
    // no longer active turns into a CHECK failure, which rolls the whole batch back.
    const mortgageStatements: D1PreparedStatement[] = [];
    const { newMortgage, redeemedMortgageId } = input.transaction;
    if (newMortgage !== undefined)
      mortgageStatements.push(
        this.database
          .prepare(
            `INSERT INTO mortgages (id, game_id, player_id, property_name, name_key, mortgage_value)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            input.transactionId,
            input.transaction.gameId,
            newMortgage.playerId,
            newMortgage.propertyName,
            propertyNameKey(newMortgage.propertyName),
            newMortgage.mortgageValue,
          ),
      );
    if (redeemedMortgageId !== undefined)
      mortgageStatements.push(
        this.database
          .prepare(
            `UPDATE mortgages
             SET state = CASE WHEN state = 'ACTIVE' THEN 'REDEEMED' ELSE 'NOT_ACTIVE' END,
                 redeemed_by_transaction_id = ?, redeemed_at = CURRENT_TIMESTAMP
             WHERE id = ? AND game_id = ?`,
          )
          .bind(input.transactionId, redeemedMortgageId, input.transaction.gameId),
      );

    // A repayment lowers the debt in the same batch. Repaying a loan that is no longer active, that
    // changed lender, or by more than is owed turns into a CHECK failure and rolls everything back.
    const loanStatements: D1PreparedStatement[] = [];
    const { newLoan, loanRepayment } = input.transaction;
    if (newLoan !== undefined)
      loanStatements.push(
        this.database
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
    if (loanRepayment !== undefined) {
      loanStatements.push(
        this.database
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
        this.database
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

    // The pot changes only here, with its own transaction. A payout is guarded by the pot it read:
    // if the pot changed since, the -1 breaks the CHECK (jackpot_balance >= 0) and rolls everything back.
    const jackpotStatements: D1PreparedStatement[] = [];
    const { jackpot } = input.transaction;
    if (jackpot?.kind === 'DEPOSIT')
      jackpotStatements.push(
        this.database
          .prepare('UPDATE games SET jackpot_balance = jackpot_balance + ? WHERE id = ?')
          .bind(jackpot.amount, input.transaction.gameId),
      );
    if (jackpot?.kind === 'COLLECT')
      jackpotStatements.push(
        this.database
          .prepare(
            'UPDATE games SET jackpot_balance = CASE WHEN jackpot_balance = ? THEN 0 ELSE -1 END WHERE id = ?',
          )
          .bind(jackpot.expected, input.transaction.gameId),
      );

    const statusStatement =
      input.bankruptPlayerId === undefined
        ? []
        : [
            this.database
              .prepare(
                "UPDATE players SET status = 'BANKRUPT', balance = 0 WHERE id = ? AND game_id = ? AND status = 'ACTIVE'",
              )
              .bind(input.bankruptPlayerId, input.transaction.gameId),
          ];
    // A bankrupt player's mortgages go to the creditor so they can be redeemed; one the creditor
    // already has under the same name is skipped by OR IGNORE and, like every mortgage of a
    // bankruptcy to the bank, is released.
    const bankruptMortgageStatements: D1PreparedStatement[] = [];
    if (input.bankruptPlayerId !== undefined) {
      if (input.mortgageHeirPlayerId != null)
        bankruptMortgageStatements.push(
          this.database
            .prepare(
              `UPDATE OR IGNORE mortgages SET player_id = ?
               WHERE game_id = ? AND player_id = ? AND state = 'ACTIVE'`,
            )
            .bind(input.mortgageHeirPlayerId, input.transaction.gameId, input.bankruptPlayerId),
        );
      bankruptMortgageStatements.push(
        this.database
          .prepare(
            `UPDATE mortgages SET state = 'RELEASED'
             WHERE game_id = ? AND player_id = ? AND state = 'ACTIVE'`,
          )
          .bind(input.transaction.gameId, input.bankruptPlayerId),
      );
    }
    // A bankrupt player's debts are forgiven; the loans they made go to the creditor, unless the
    // creditor is the borrower (nobody lends to themselves) or the bankruptcy is to the bank.
    const bankruptLoanStatements: D1PreparedStatement[] = [];
    if (input.bankruptPlayerId !== undefined) {
      const gameId = input.transaction.gameId;
      // The bank took its share of the wallet first. A loan that is no longer active, or whose
      // principal does not match how it ended, turns into a CHECK failure and rolls everything back.
      const settlement = input.transaction.bankLoanSettlement;
      if (settlement !== undefined && settlement.paidPrincipal > 0)
        bankruptLoanStatements.push(
          this.database
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
              gameId,
              settlement.borrowerPlayerId,
              settlement.outcome,
            ),
          this.database
            .prepare(
              `INSERT INTO loan_repayments (transaction_id, game_id, loan_id, amount, interest_amount, interest_rate_percent, suggested_rate_percent)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              input.transactionId,
              gameId,
              settlement.loanId,
              settlement.paidPrincipal,
              settlement.paidInterest,
              settlement.interestRatePercent,
              settlement.suggestedRatePercent,
            ),
        );
      bankruptLoanStatements.push(
        this.database
          .prepare(
            `UPDATE loans SET state = 'WRITTEN_OFF', closed_at = CURRENT_TIMESTAMP
             WHERE game_id = ? AND borrower_player_id = ? AND state = 'ACTIVE'`,
          )
          .bind(gameId, input.bankruptPlayerId),
      );
      if (input.loanHeirPlayerId != null)
        bankruptLoanStatements.push(
          this.database
            .prepare(
              `UPDATE loans SET lender_player_id = ?
               WHERE game_id = ? AND lender_player_id = ? AND borrower_player_id <> ? AND state = 'ACTIVE'`,
            )
            .bind(input.loanHeirPlayerId, gameId, input.bankruptPlayerId, input.loanHeirPlayerId),
        );
      bankruptLoanStatements.push(
        this.database
          .prepare(
            `UPDATE loans SET state = 'WRITTEN_OFF', closed_at = CURRENT_TIMESTAMP
             WHERE game_id = ? AND lender_player_id = ? AND state = 'ACTIVE'`,
          )
          .bind(gameId, input.bankruptPlayerId),
      );
    }
    try {
      const recentStatements =
        input.recentAmount === undefined
          ? []
          : recentAmountStatements(this.database, input.transaction.gameId, input.recentAmount);
      await this.database.batch([
        balanceStatement,
        transactionStatement,
        ...participantStatements,
        ...mortgageStatements,
        ...loanStatements,
        ...jackpotStatements,
        ...statusStatement,
        ...bankruptMortgageStatements,
        ...bankruptLoanStatements,
        ...recentStatements,
      ]);
    } catch (cause) {
      throw new DatabaseError({ operation: 'persistBankingOperation', cause });
    }
  }
}

function recentAmountStatements(
  database: D1Database,
  gameId: string,
  amount: number,
): D1PreparedStatement[] {
  return [
    database
      .prepare('DELETE FROM game_recent_amounts WHERE game_id = ? AND amount = ?')
      .bind(gameId, amount),
    database
      .prepare(
        'INSERT INTO game_recent_amounts (game_id, amount, used_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
      )
      .bind(gameId, amount),
    database
      .prepare(
        'DELETE FROM game_recent_amounts WHERE game_id = ? AND amount NOT IN (SELECT amount FROM game_recent_amounts WHERE game_id = ? ORDER BY used_at DESC, amount DESC LIMIT 5)',
      )
      .bind(gameId, gameId),
  ];
}

function createBalanceUpdateStatement(
  database: D1Database,
  balanceChanges: readonly PlayerBalanceChange[],
): D1PreparedStatement {
  const gameId = balanceChanges[0]?.player.gameId;
  if (gameId === undefined && balanceChanges.length === 0) {
    return database.prepare('SELECT 1');
  }
  if (gameId === undefined || balanceChanges.some((change) => change.player.gameId !== gameId)) {
    throw new Error('All balance changes must belong to the same game.');
  }

  const cases = balanceChanges.map(() => 'WHEN ? THEN CASE WHEN balance = ? THEN ? ELSE -1 END');
  const values: (string | number)[] = [];
  for (const change of balanceChanges) {
    values.push(change.player.id, change.balanceBefore, change.balanceAfter);
  }
  const playerIds = balanceChanges.map((change) => change.player.id);
  values.push(gameId, ...playerIds);

  return database
    .prepare(
      `UPDATE players
       SET balance = CASE id ${cases.join(' ')} ELSE balance END
       WHERE game_id = ? AND id IN (${playerIds.map(() => '?').join(', ')})`,
    )
    .bind(...values);
}
