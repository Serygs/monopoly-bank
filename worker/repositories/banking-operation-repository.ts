import type { PlayerBalanceChange, PendingTransaction } from '../../shared/domain/banking.js';

export interface PersistBankingOperationInput {
  transactionId: string;
  transaction: PendingTransaction;
  balanceChanges: readonly PlayerBalanceChange[];
  bankruptPlayerId?: string;
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
        `INSERT INTO transactions (id, game_id, type, amount, total_amount, comment)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.transactionId,
        input.transaction.gameId,
        input.transaction.type,
        input.transaction.amount,
        input.transaction.totalAmount,
        input.transaction.comment,
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

    const statusStatement = input.bankruptPlayerId === undefined ? [] : [this.database.prepare("UPDATE players SET status = 'BANKRUPT', balance = 0 WHERE id = ? AND game_id = ? AND status = 'ACTIVE'").bind(input.bankruptPlayerId, input.transaction.gameId)];
    await this.database.batch([balanceStatement, transactionStatement, ...participantStatements, ...statusStatement]);
  }
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
