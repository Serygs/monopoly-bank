import type {
  Transaction,
  TransactionParticipant,
  TransactionType,
} from '../../shared/types/monopoly.js';

interface TransactionRow {
  id: string;
  game_id: string;
  type: TransactionType;
  amount: number;
  total_amount: number;
  comment: string | null;
  created_at: string;
  reverses_transaction_id: string | null;
  tile_id: string | null;
  price_overridden: number;
  reversed_by_transaction_id: string | null;
  player_id: string | null;
  balance_delta: number | null;
}

export interface CreateTransactionInput {
  id: string;
  gameId: string;
  type: TransactionType;
  amount: number;
  totalAmount: number;
  comment?: string | null;
  participants: TransactionParticipant[];
}

export interface TransactionRepository {
  create(input: CreateTransactionInput): Promise<void>;
  getById(gameId: string, transactionId: string): Promise<Transaction | null>;
  listByGameId(gameId: string, limit?: number): Promise<Transaction[]>;
  listByPlayerId(gameId: string, playerId: string, limit?: number): Promise<Transaction[]>;
  /**
   * Every transaction from the earliest of the given ones onwards (that one included), oldest
   * first, in the order they were written. Empty without anchors. Used to infer whose turn it was.
   */
  listChronologicalSince(
    gameId: string,
    anchorTransactionIds: readonly string[],
    latest?: number,
  ): Promise<Transaction[]>;
}

export class D1TransactionRepository implements TransactionRepository {
  private readonly database: D1Database;

  constructor(database: D1Database) {
    this.database = database;
  }

  async create(input: CreateTransactionInput): Promise<void> {
    if (input.participants.length === 0) {
      throw new Error('A transaction must include at least one player participant.');
    }

    const transactionStatement = this.database
      .prepare(
        `INSERT INTO transactions (id, game_id, type, amount, total_amount, comment)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.id,
        input.gameId,
        input.type,
        input.amount,
        input.totalAmount,
        input.comment ?? null,
      );
    const participantStatements = input.participants.map((participant) =>
      this.database
        .prepare(
          `INSERT INTO transaction_participants (transaction_id, game_id, player_id, balance_delta)
           VALUES (?, ?, ?, ?)`,
        )
        .bind(input.id, input.gameId, participant.playerId, participant.balanceDelta),
    );

    await this.database.batch([transactionStatement, ...participantStatements]);
  }

  async listByGameId(gameId: string, limit = 100): Promise<Transaction[]> {
    const result = await this.database
      .prepare(
        `${transactionSelect}
         WHERE transactions.id IN (
           SELECT id
           FROM transactions
           WHERE game_id = ?
           ORDER BY created_at DESC, id DESC
           LIMIT ?
         )
         ORDER BY transactions.created_at DESC, transactions.id DESC, transaction_participants.player_id ASC
        `,
      )
      .bind(gameId, limit)
      .all<TransactionRow>();

    return mapTransactions(result.results);
  }

  async listChronologicalSince(
    gameId: string,
    anchorTransactionIds: readonly string[],
    latest?: number,
  ): Promise<Transaction[]> {
    if (anchorTransactionIds.length === 0) return [];
    // With `latest`, only the game's newest `latest` transactions are read, even if an anchor is older.
    const window =
      latest === undefined
        ? ''
        : `AND transactions.rowid >= COALESCE((
             SELECT recent.rowid FROM transactions AS recent WHERE recent.game_id = ?1
             ORDER BY recent.rowid DESC LIMIT 1 OFFSET ${Math.max(0, Math.floor(latest) - 1)}
           ), 0)`;
    const result = await this.database
      .prepare(
        `${transactionSelect}
         WHERE transactions.game_id = ?1
           AND transactions.rowid >= (
             SELECT MIN(anchor.rowid) FROM transactions AS anchor
             WHERE anchor.game_id = ?1 AND anchor.id IN (${anchorTransactionIds.map((_, index) => `?${index + 2}`).join(', ')})
           )
           ${window}
         ORDER BY transactions.rowid ASC, transaction_participants.player_id ASC`,
      )
      .bind(gameId, ...anchorTransactionIds)
      .all<TransactionRow>();

    return mapTransactions(result.results);
  }

  async getById(gameId: string, transactionId: string): Promise<Transaction | null> {
    const result = await this.database
      .prepare(
        `${transactionSelect}
         WHERE transactions.game_id = ? AND transactions.id = ?
         ORDER BY transaction_participants.player_id ASC`,
      )
      .bind(gameId, transactionId)
      .all<TransactionRow>();

    return mapTransactions(result.results)[0] ?? null;
  }

  async listByPlayerId(gameId: string, playerId: string, limit = 100): Promise<Transaction[]> {
    const result = await this.database
      .prepare(
        `${transactionSelect}
         WHERE transactions.id IN (
           SELECT id
           FROM transactions
           WHERE game_id = ?
             AND EXISTS (
               SELECT 1
               FROM transaction_participants AS player_participants
               WHERE player_participants.transaction_id = transactions.id
                 AND player_participants.player_id = ?
             )
           ORDER BY created_at DESC, id DESC
           LIMIT ?
           )
         ORDER BY transactions.created_at DESC, transactions.id DESC, transaction_participants.player_id ASC`,
      )
      .bind(gameId, playerId, limit)
      .all<TransactionRow>();

    return mapTransactions(result.results);
  }
}

const transactionSelect = `SELECT
  transactions.id,
  transactions.game_id,
  transactions.type,
  transactions.amount,
  transactions.total_amount,
  transactions.comment,
  transactions.created_at,
  transactions.reverses_transaction_id,
  transactions.tile_id,
  transactions.price_overridden,
  reversal.id AS reversed_by_transaction_id,
  transaction_participants.player_id,
  transaction_participants.balance_delta
FROM transactions
LEFT JOIN transactions AS reversal ON reversal.reverses_transaction_id = transactions.id
LEFT JOIN transaction_participants ON transaction_participants.transaction_id = transactions.id`;

function mapTransactions(rows: TransactionRow[]): Transaction[] {
  const transactions = new Map<string, Transaction>();

  for (const row of rows) {
    let transaction = transactions.get(row.id);
    if (transaction === undefined) {
      transaction = {
        id: row.id,
        gameId: row.game_id,
        type: row.type,
        amount: row.amount,
        totalAmount: row.total_amount,
        comment: row.comment,
        createdAt: row.created_at,
        participants: [],
        ...(row.tile_id == null ? {} : { tileId: row.tile_id }),
        ...(row.price_overridden === 1 ? { priceOverridden: true } : {}),
        reversesTransactionId: row.reverses_transaction_id ?? null,
        reversedByTransactionId: row.reversed_by_transaction_id ?? null,
      };
      transactions.set(row.id, transaction);
    }

    if (row.player_id !== null && row.balance_delta !== null)
      transaction.participants.push({ playerId: row.player_id, balanceDelta: row.balance_delta });
  }

  return [...transactions.values()];
}
