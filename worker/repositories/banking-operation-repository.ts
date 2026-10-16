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
        ...statusStatement,
        ...bankruptMortgageStatements,
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
