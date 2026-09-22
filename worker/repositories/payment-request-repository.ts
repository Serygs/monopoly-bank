import type { PaymentRequest, PaymentRequestState } from '../../shared/contracts/api.js';
import type { PendingTransaction, PlayerBalanceChange } from '../../shared/domain/banking.js';
import { D1BankingOperationRepository } from './banking-operation-repository.js';

interface PaymentRequestRow {
  id: string; game_id: string; payer_player_id: string; recipient_player_id: string; creator_player_id: string; approver_player_id: string;
  amount: number; comment: string | null; state: PaymentRequestState; expires_at: string;
  created_at: string; resolved_at: string | null; transaction_id: string | null; board_space_id: string | null;
}

export type CreatePaymentRequestInput = Omit<PaymentRequest, 'createdAt' | 'resolvedAt' | 'transactionId'>;

export interface PaymentRequestRepository {
  create(input: CreatePaymentRequestInput): Promise<void>;
  getById(gameId: string, id: string): Promise<PaymentRequest | null>;
  listForPayers(gameId: string, payerPlayerIds: readonly string[]): Promise<PaymentRequest[]>;
  pendingReservedAmount(gameId: string, payerPlayerId: string): Promise<number>;
  expirePending(gameId: string): Promise<void>;
  settle(input: { requestId: string; transactionId: string; transaction: PendingTransaction; balanceChanges: readonly PlayerBalanceChange[] }): Promise<void>;
  resolve(requestId: string, state: Extract<PaymentRequestState, 'DECLINED' | 'CANCELLED'>): Promise<boolean>;
}

const paymentRequestColumns = 'id, game_id, payer_player_id, recipient_player_id, creator_player_id, approver_player_id, amount, comment, state, expires_at, created_at, resolved_at, transaction_id, board_space_id';

export class D1PaymentRequestRepository implements PaymentRequestRepository {
  private readonly database: D1Database;
  constructor(database: D1Database) { this.database = database; }

  async create(input: CreatePaymentRequestInput): Promise<void> {
    await this.database.prepare(`INSERT INTO payment_requests (id, game_id, payer_player_id, recipient_player_id, creator_player_id, approver_player_id, amount, comment, state, expires_at, board_space_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`).bind(input.id, input.gameId, input.payerPlayerId, input.recipientPlayerId, input.creatorPlayerId, input.approverPlayerId, input.amount, input.comment, input.state, input.expiresAt, input.boardSpaceId ?? null).run();
  }

  async getById(gameId: string, id: string): Promise<PaymentRequest | null> {
    const row = await this.database.prepare(`SELECT ${paymentRequestColumns} FROM payment_requests WHERE game_id = ? AND id = ?`).bind(gameId, id).first<PaymentRequestRow>();
    return row === null ? null : mapPaymentRequest(row);
  }

  async listForPayers(gameId: string, payerPlayerIds: readonly string[]): Promise<PaymentRequest[]> {
    if (payerPlayerIds.length === 0) return [];
    await this.expirePending(gameId);
    const result = await this.database.prepare(`SELECT ${paymentRequestColumns}
      FROM payment_requests WHERE game_id = ? AND approver_player_id IN (${payerPlayerIds.map(() => '?').join(', ')}) AND state = 'PENDING'
      ORDER BY created_at ASC, id ASC`).bind(gameId, ...payerPlayerIds).all<PaymentRequestRow>();
    return result.results.map(mapPaymentRequest);
  }

  async pendingReservedAmount(gameId: string, payerPlayerId: string): Promise<number> {
    await this.expirePending(gameId);
    const row = await this.database.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM payment_requests
      WHERE game_id = ? AND payer_player_id = ? AND state = 'PENDING' AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`).bind(gameId, payerPlayerId).first<{ total: number }>();
    return row?.total ?? 0;
  }

  async expirePending(gameId: string): Promise<void> {
    await this.database.prepare(`UPDATE payment_requests SET state = 'EXPIRED', resolved_at = CURRENT_TIMESTAMP
      WHERE game_id = ? AND state = 'PENDING' AND expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`).bind(gameId).run();
  }

  /** One batch shared with every other banking write: balances, transaction, participants and the request's settlement. */
  async settle(input: { requestId: string; transactionId: string; transaction: PendingTransaction; balanceChanges: readonly PlayerBalanceChange[] }): Promise<void> {
    await new D1BankingOperationRepository(this.database).persist({
      transactionId: input.transactionId,
      transaction: input.transaction,
      balanceChanges: input.balanceChanges,
      recentAmount: input.transaction.amount,
      paymentRequestSettlement: { requestId: input.requestId },
    });
  }

  async resolve(requestId: string, state: Extract<PaymentRequestState, 'DECLINED' | 'CANCELLED'>): Promise<boolean> {
    const result = await this.database.prepare(`UPDATE payment_requests SET state = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ? AND state = 'PENDING'`).bind(state, requestId).run();
    return result.meta.changes === 1;
  }
}

function mapPaymentRequest(row: PaymentRequestRow): PaymentRequest {
  return { id: row.id, gameId: row.game_id, payerPlayerId: row.payer_player_id, recipientPlayerId: row.recipient_player_id, creatorPlayerId: row.creator_player_id, approverPlayerId: row.approver_player_id, amount: row.amount, comment: row.comment, state: row.state, expiresAt: row.expires_at, createdAt: row.created_at, resolvedAt: row.resolved_at, transactionId: row.transaction_id, boardSpaceId: row.board_space_id ?? null };
}
