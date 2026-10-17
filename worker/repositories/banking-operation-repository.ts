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
  /**
   * With a bankruptcy in a game with the auctions rule: the leading bidder's bid is withdrawn (no
   * leader, the floor stays) in the bankruptcy's own batch.
   */
  withdrawAuctionBid?: boolean;
  /**
   * With an accepted trade: the pending trade request this transaction fulfils. It turns ACCEPTED
   * in the same batch; a request that is no longer pending (or has expired) breaks the state CHECK
   * on purpose, so the whole batch rolls back and nothing is written.
   */
  acceptTradeRequestId?: string;
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

    const tradeRequestStatements =
      input.acceptTradeRequestId === undefined
        ? []
        : [
            this.database
              .prepare(
                `UPDATE trade_requests SET
                   state = CASE WHEN state = 'PENDING' AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now') THEN 'ACCEPTED' ELSE 'NOT_PENDING' END,
                   resolved_at = CURRENT_TIMESTAMP, transaction_id = ?
                 WHERE id = ? AND game_id = ?`,
              )
              .bind(input.transactionId, input.acceptTradeRequestId, input.transaction.gameId),
          ];
    // A bankrupt player's pending trades can never be accepted: cancelled in the bankruptcy's batch.
    const bankruptTradeStatements =
      input.bankruptPlayerId === undefined
        ? []
        : [
            this.database
              .prepare(
                `UPDATE trade_requests SET state = 'CANCELLED', resolved_at = CURRENT_TIMESTAMP
                 WHERE game_id = ? AND state = 'PENDING' AND (proposer_player_id = ? OR counterparty_player_id = ?)`,
              )
              .bind(input.transaction.gameId, input.bankruptPlayerId, input.bankruptPlayerId),
          ];

    // The mortgage record is written in the same batch as its transaction. Redeeming one that is
    // no longer active turns into a CHECK failure, which rolls the whole batch back.
    const mortgageStatements: D1PreparedStatement[] = [];
    const { newMortgage, redeemedMortgageId } = input.transaction;
    if (newMortgage !== undefined)
      mortgageStatements.push(
        this.database
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

    // Reversing a board mortgage keeps its row in step. A row that is no longer in the state the
    // original left it in turns into a CHECK failure and rolls the whole batch back.
    const { mortgageReversal } = input.transaction;
    if (mortgageReversal?.kind === 'CANCEL')
      mortgageStatements.push(
        this.database
          .prepare(
            `UPDATE mortgages
             SET state = CASE WHEN state = 'ACTIVE' THEN 'RELEASED' ELSE 'NOT_ACTIVE' END
             WHERE id = ? AND game_id = ?`,
          )
          .bind(mortgageReversal.mortgageId, input.transaction.gameId),
      );
    if (mortgageReversal?.kind === 'RESTORE')
      mortgageStatements.push(
        this.database
          .prepare(
            `UPDATE mortgages
             SET state = CASE WHEN state = 'REDEEMED' THEN 'ACTIVE' ELSE 'NOT_ACTIVE' END,
                 redeemed_by_transaction_id = NULL, redeemed_at = NULL
             WHERE id = ? AND game_id = ?`,
          )
          .bind(mortgageReversal.mortgageId, input.transaction.gameId),
      );

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
          mortgageStatements.push(
            this.database
              .prepare(
                `UPDATE mortgages SET player_id = ?
                 WHERE game_id = ? AND tile_id = ? AND state = 'ACTIVE'`,
              )
              .bind(change.after.ownerPlayerId, input.transaction.gameId, change.tileId),
          );

    // Board games: each registry change is guarded by the state it read. A tile that moved on makes
    // the mortgaged flag -1, which breaks its CHECK and rolls the whole batch back (balances included).
    const registryStatements: D1PreparedStatement[] = [];
    for (const change of input.transaction.registryChanges ?? [])
      registryStatements.push(
        this.database
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
        this.database
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

    // Settling an auction closes it in the same batch as its payment. If it is no longer ACTIVE at
    // the version that was read (a concurrent settlement, a bid, a bankrupt leader), 'NOT_ACTIVE'
    // breaks the state CHECK and the whole batch, balance included, rolls back.
    const auctionStatements: D1PreparedStatement[] = [];
    const { settlesAuction } = input.transaction;
    if (settlesAuction !== undefined)
      auctionStatements.push(
        this.database
          .prepare(
            `UPDATE auctions
             SET state = CASE WHEN state = 'ACTIVE' AND version = ?1 THEN 'SOLD' ELSE 'NOT_ACTIVE' END,
                 settled_transaction_id = ?2, version = version + 1
             WHERE id = ?3 AND game_id = ?4`,
          )
          .bind(
            settlesAuction.expectedVersion,
            input.transactionId,
            settlesAuction.auctionId,
            input.transaction.gameId,
          ),
      );
    if (input.bankruptPlayerId !== undefined && input.withdrawAuctionBid === true)
      auctionStatements.push(
        this.database
          .prepare(
            `UPDATE auctions SET current_bidder_id = NULL, version = version + 1
             WHERE game_id = ? AND state = 'ACTIVE' AND current_bidder_id = ?`,
          )
          .bind(input.transaction.gameId, input.bankruptPlayerId),
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
        ...tradeRequestStatements,
        ...registryStatements,
        ...mortgageStatements,
        ...loanStatements,
        ...jackpotStatements,
        ...auctionStatements,
        ...statusStatement,
        ...bankruptMortgageStatements,
        ...bankruptLoanStatements,
        ...bankruptTradeStatements,
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
