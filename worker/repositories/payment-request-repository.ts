import type { PaymentRequest, PaymentRequestState } from '../../shared/contracts/api.js';
import type { PendingTransaction, PlayerBalanceChange } from '../../shared/domain/banking.js';
import { DatabaseError } from '../services/errors.js';

interface PaymentRequestRow {
  id: string; game_id: string; payer_player_id: string; recipient_player_id: string; creator_player_id: string; approver_player_id: string;
  amount: number; comment: string | null; state: PaymentRequestState; expires_at: string;
  created_at: string; resolved_at: string | null; transaction_id: string | null;
}

export interface PaymentRequestRepository {
  create(input: Omit<PaymentRequest, 'createdAt' | 'resolvedAt' | 'transactionId'>): Promise<void>;
  getById(gameId: string, id: string): Promise<PaymentRequest | null>;
  listForPayers(gameId: string, payerPlayerIds: readonly string[]): Promise<PaymentRequest[]>;
  pendingReservedAmount(gameId: string, payerPlayerId: string): Promise<number>;
  expirePending(gameId: string): Promise<void>;
  settle(input: { requestId: string; transactionId: string; transaction: PendingTransaction; balanceChanges: readonly PlayerBalanceChange[] }): Promise<void>;
  resolve(requestId: string, state: Extract<PaymentRequestState, 'DECLINED' | 'CANCELLED'>): Promise<boolean>;
}

export class D1PaymentRequestRepository implements PaymentRequestRepository {
  private readonly database: D1Database;
  constructor(database: D1Database) { this.database = database; }

  async create(input: Omit<PaymentRequest, 'createdAt' | 'resolvedAt' | 'transactionId'>): Promise<void> {
    await this.database.prepare(`INSERT INTO payment_requests (id, game_id, payer_player_id, recipient_player_id, creator_player_id, approver_player_id, amount, comment, state, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`).bind(input.id, input.gameId, input.payerPlayerId, input.recipientPlayerId, input.creatorPlayerId, input.approverPlayerId, input.amount, input.comment, input.state, input.expiresAt).run();
  }

  async getById(gameId: string, id: string): Promise<PaymentRequest | null> {
    const row = await this.database.prepare(`SELECT id, game_id, payer_player_id, recipient_player_id, creator_player_id, approver_player_id, amount, comment, state, expires_at, created_at, resolved_at, transaction_id
      FROM payment_requests WHERE game_id = ? AND id = ?`).bind(gameId, id).first<PaymentRequestRow>();
    return row === null ? null : mapPaymentRequest(row);
  }

  async listForPayers(gameId: string, payerPlayerIds: readonly string[]): Promise<PaymentRequest[]> {
    if (payerPlayerIds.length === 0) return [];
    await this.expirePending(gameId);
    const result = await this.database.prepare(`SELECT id, game_id, payer_player_id, recipient_player_id, creator_player_id, approver_player_id, amount, comment, state, expires_at, created_at, resolved_at, transaction_id
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

  async settle(input: { requestId: string; transactionId: string; transaction: PendingTransaction; balanceChanges: readonly PlayerBalanceChange[] }): Promise<void> {
    const balanceStatement = balanceUpdate(this.database, input.balanceChanges);
    const transactionStatement = this.database.prepare(`INSERT INTO transactions (id, game_id, type, amount, total_amount, comment) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(input.transactionId, input.transaction.gameId, input.transaction.type, input.transaction.amount, input.transaction.totalAmount, input.transaction.comment);
    const participants = input.transaction.participants.map((participant) => this.database.prepare(`INSERT INTO transaction_participants (transaction_id, game_id, player_id, balance_delta) VALUES (?, ?, ?, ?)`)
      .bind(input.transactionId, input.transaction.gameId, participant.playerId, participant.balanceDelta));
    const requestStatement = this.database.prepare(`UPDATE payment_requests SET state = 'ACCEPTED', resolved_at = CURRENT_TIMESTAMP, transaction_id = ?
      WHERE id = ? AND state = 'PENDING' AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`).bind(input.transactionId, input.requestId);
    const recentStatements = [this.database.prepare('DELETE FROM game_recent_amounts WHERE game_id = ? AND amount = ?').bind(input.transaction.gameId, input.transaction.amount), this.database.prepare('INSERT INTO game_recent_amounts (game_id, amount, used_at) VALUES (?, ?, CURRENT_TIMESTAMP)').bind(input.transaction.gameId, input.transaction.amount), this.database.prepare('DELETE FROM game_recent_amounts WHERE game_id = ? AND amount NOT IN (SELECT amount FROM game_recent_amounts WHERE game_id = ? ORDER BY used_at DESC, amount DESC LIMIT 5)').bind(input.transaction.gameId, input.transaction.gameId)];
    try { await this.database.batch([balanceStatement, transactionStatement, ...participants, requestStatement, ...recentStatements]); }
    catch (cause) { throw new DatabaseError({ operation: 'settlePaymentRequest', cause }); }
  }

  async resolve(requestId: string, state: Extract<PaymentRequestState, 'DECLINED' | 'CANCELLED'>): Promise<boolean> {
    const result = await this.database.prepare(`UPDATE payment_requests SET state = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ? AND state = 'PENDING'`).bind(state, requestId).run();
    return result.meta.changes === 1;
  }
}

function balanceUpdate(database: D1Database, changes: readonly PlayerBalanceChange[]): D1PreparedStatement {
  const gameId = changes[0]?.player.gameId;
  if (gameId === undefined) return database.prepare('SELECT 1');
  const cases = changes.map(() => 'WHEN ? THEN CASE WHEN balance = ? THEN ? ELSE -1 END');
  const values: Array<string | number> = [];
  for (const change of changes) values.push(change.player.id, change.balanceBefore, change.balanceAfter);
  const ids = changes.map((change) => change.player.id);
  return database.prepare(`UPDATE players SET balance = CASE id ${cases.join(' ')} ELSE balance END WHERE game_id = ? AND id IN (${ids.map(() => '?').join(', ')})`).bind(...values, gameId, ...ids);
}

function mapPaymentRequest(row: PaymentRequestRow): PaymentRequest {
  return { id: row.id, gameId: row.game_id, payerPlayerId: row.payer_player_id, recipientPlayerId: row.recipient_player_id, creatorPlayerId: row.creator_player_id, approverPlayerId: row.approver_player_id, amount: row.amount, comment: row.comment, state: row.state, expiresAt: row.expires_at, createdAt: row.created_at, resolvedAt: row.resolved_at, transactionId: row.transaction_id };
}
