import type {
  PaymentRequest,
  PaymentRequestKind,
  PaymentRequestState,
} from '../../shared/contracts/api.js';
import type { PendingTransaction, PlayerBalanceChange } from '../../shared/domain/banking.js';
import { DatabaseError } from '../services/errors.js';
import { guardedBalanceUpdate } from './balance-statements.js';
import { recentAmountStatement } from './recent-amounts.js';

/** How long a payment or trade request waits for an answer. */
export const PAYMENT_REQUEST_TTL_MS = 5 * 60 * 1000;

export interface PaymentRequestRow {
  id: string;
  kind: PaymentRequestKind;
  game_id: string;
  payer_player_id: string;
  recipient_player_id: string;
  creator_player_id: string;
  approver_player_id: string;
  amount: number;
  comment: string | null;
  state: PaymentRequestState;
  expires_at: string;
  created_at: string;
  resolved_at: string | null;
  transaction_id: string | null;
}

export interface PaymentRequestRepository {
  create(input: Omit<PaymentRequest, 'createdAt' | 'resolvedAt' | 'transactionId'>): Promise<void>;
  getById(gameId: string, id: string): Promise<PaymentRequest | null>;
  /**
   * The PENDING requests an actor's wallets either have to answer (approver) or started and may
   * still cancel (creator), oldest first.
   */
  listForPayers(gameId: string, payerPlayerIds: readonly string[]): Promise<PaymentRequest[]>;
  pendingReservedAmount(gameId: string, payerPlayerId: string): Promise<number>;
  expirePending(gameId: string): Promise<void>;
  settle(input: {
    requestId: string;
    transactionId: string;
    transaction: PendingTransaction;
    balanceChanges: readonly PlayerBalanceChange[];
  }): Promise<void>;
  resolve(
    requestId: string,
    state: Extract<PaymentRequestState, 'DECLINED' | 'CANCELLED'>,
  ): Promise<boolean>;
}

export class D1PaymentRequestRepository implements PaymentRequestRepository {
  private readonly database: D1Database;
  constructor(database: D1Database) {
    this.database = database;
  }

  async create(
    input: Omit<PaymentRequest, 'createdAt' | 'resolvedAt' | 'transactionId'>,
  ): Promise<void> {
    await this.database
      .prepare(
        `INSERT INTO payment_requests (id, kind, game_id, payer_player_id, recipient_player_id, creator_player_id, approver_player_id, amount, comment, state, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
      )
      .bind(
        input.id,
        input.kind,
        input.gameId,
        input.payerPlayerId,
        input.recipientPlayerId,
        input.creatorPlayerId,
        input.approverPlayerId,
        input.amount,
        input.comment,
        input.state,
        input.expiresAt,
      )
      .run();
  }

  async getById(gameId: string, id: string): Promise<PaymentRequest | null> {
    const row = await this.database
      .prepare(
        `SELECT id, kind, game_id, payer_player_id, recipient_player_id, creator_player_id, approver_player_id, amount, comment, state, expires_at, created_at, resolved_at, transaction_id
      FROM payment_requests WHERE game_id = ? AND id = ?`,
      )
      .bind(gameId, id)
      .first<PaymentRequestRow>();
    return row === null ? null : mapPaymentRequest(row);
  }

  async listForPayers(
    gameId: string,
    payerPlayerIds: readonly string[],
  ): Promise<PaymentRequest[]> {
    if (payerPlayerIds.length === 0) return [];
    await this.expirePending(gameId);
    const placeholders = payerPlayerIds.map(() => '?').join(', ');
    const result = await this.database
      .prepare(
        `SELECT id, kind, game_id, payer_player_id, recipient_player_id, creator_player_id, approver_player_id, amount, comment, state, expires_at, created_at, resolved_at, transaction_id
      FROM payment_requests WHERE game_id = ?
        AND (approver_player_id IN (${placeholders}) OR creator_player_id IN (${placeholders}))
        AND state = 'PENDING'
      ORDER BY created_at ASC, id ASC`,
      )
      .bind(gameId, ...payerPlayerIds, ...payerPlayerIds)
      .all<PaymentRequestRow>();
    return result.results.map(mapPaymentRequest);
  }

  async pendingReservedAmount(gameId: string, payerPlayerId: string): Promise<number> {
    await this.expirePending(gameId);
    const row = await this.database
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM payment_requests
      WHERE game_id = ? AND payer_player_id = ? AND state = 'PENDING' AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      )
      .bind(gameId, payerPlayerId)
      .first<{ total: number }>();
    return row?.total ?? 0;
  }

  async expirePending(gameId: string): Promise<void> {
    await this.database
      .prepare(
        `UPDATE payment_requests SET state = 'EXPIRED', resolved_at = CURRENT_TIMESTAMP
      WHERE game_id = ? AND state = 'PENDING' AND expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      )
      .bind(gameId)
      .run();
  }

  async settle(input: {
    requestId: string;
    transactionId: string;
    transaction: PendingTransaction;
    balanceChanges: readonly PlayerBalanceChange[];
  }): Promise<void> {
    const balanceStatement = guardedBalanceUpdate(this.database, input.balanceChanges, {
      condition: `EXISTS (SELECT 1 FROM payment_requests WHERE id = ? AND state = 'PENDING' AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
      value: input.requestId,
    });
    const transactionStatement = this.database
      .prepare(
        `INSERT INTO transactions (id, game_id, type, amount, total_amount, comment) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.transactionId,
        input.transaction.gameId,
        input.transaction.type,
        input.transaction.amount,
        input.transaction.totalAmount,
        input.transaction.comment,
      );
    const participants = input.transaction.participants.map((participant) =>
      this.database
        .prepare(
          `INSERT INTO transaction_participants (transaction_id, game_id, player_id, balance_delta) VALUES (?, ?, ?, ?)`,
        )
        .bind(
          input.transactionId,
          input.transaction.gameId,
          participant.playerId,
          participant.balanceDelta,
        ),
    );
    const requestStatement = this.database
      .prepare(
        `UPDATE payment_requests SET state = 'ACCEPTED', resolved_at = CURRENT_TIMESTAMP, transaction_id = ?
      WHERE id = ? AND state = 'PENDING' AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      )
      .bind(input.transactionId, input.requestId);
    // A loan request creates its loan record in the same batch as the transaction that funds it.
    const { newLoan } = input.transaction;
    const loanStatements =
      newLoan === undefined
        ? []
        : [
            this.database
              .prepare(
                `INSERT INTO loans (id, game_id, lender_kind, lender_player_id, borrower_player_id, principal)
                 VALUES (?, ?, 'PLAYER', ?, ?,
                   CASE WHEN EXISTS (SELECT 1 FROM payment_requests WHERE id = ? AND state = 'ACCEPTED' AND transaction_id = ?)
                     THEN ? ELSE 0 END)`,
              )
              // A request that expired a moment ago was not accepted: principal 0 breaks the
              // CHECK, so the whole batch (balances, transaction, loan) rolls back.
              .bind(
                input.transactionId,
                input.transaction.gameId,
                newLoan.lenderPlayerId,
                newLoan.borrowerPlayerId,
                input.requestId,
                input.transactionId,
                newLoan.principal,
              ),
          ];
    try {
      await this.database.batch([
        balanceStatement,
        transactionStatement,
        ...participants,
        requestStatement,
        ...loanStatements,
        await recentAmountStatement(
          this.database,
          input.transaction.gameId,
          input.transaction.amount,
        ),
      ]);
    } catch (cause) {
      throw new DatabaseError({ operation: 'settlePaymentRequest', cause });
    }
  }

  async resolve(
    requestId: string,
    state: Extract<PaymentRequestState, 'DECLINED' | 'CANCELLED'>,
  ): Promise<boolean> {
    const result = await this.database
      .prepare(
        `UPDATE payment_requests SET state = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ? AND state = 'PENDING'`,
      )
      .bind(state, requestId)
      .run();
    return result.meta.changes === 1;
  }
}

export function mapPaymentRequest(row: PaymentRequestRow): PaymentRequest {
  return {
    id: row.id,
    kind: row.kind,
    gameId: row.game_id,
    payerPlayerId: row.payer_player_id,
    recipientPlayerId: row.recipient_player_id,
    creatorPlayerId: row.creator_player_id,
    approverPlayerId: row.approver_player_id,
    amount: row.amount,
    comment: row.comment,
    state: row.state,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    transactionId: row.transaction_id,
  };
}
