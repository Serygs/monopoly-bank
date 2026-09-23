import { ConflictError, DatabaseError } from '../services/errors.js';

export interface CommandLedgerEntry {
  gameId: string;
  commandId: string;
  actorId: string;
  commandType: string;
  payloadHash: string;
  status: 'PENDING' | 'COMPLETED';
  resultStatus: number | null;
  resultJson: string | null;
  resultTransactionId: string | null;
}
export interface CommandLedgerRepository {
  claim(
    input: Omit<
      CommandLedgerEntry,
      'status' | 'resultStatus' | 'resultJson' | 'resultTransactionId'
    >,
  ): Promise<CommandLedgerEntry>;
  complete(input: {
    gameId: string;
    commandId: string;
    status: number;
    result: unknown;
    transactionId: string | null;
  }): Promise<void>;
}

export class D1CommandLedgerRepository implements CommandLedgerRepository {
  private readonly database: D1Database;
  constructor(database: D1Database) {
    this.database = database;
  }
  async claim(
    input: Omit<
      CommandLedgerEntry,
      'status' | 'resultStatus' | 'resultJson' | 'resultTransactionId'
    >,
  ): Promise<CommandLedgerEntry> {
    try {
      await this.database
        .prepare(
          "INSERT INTO command_ledger (game_id, command_id, actor_id, command_type, payload_hash, status) VALUES (?, ?, ?, ?, ?, 'PENDING') ON CONFLICT(game_id, command_id) DO NOTHING",
        )
        .bind(input.gameId, input.commandId, input.actorId, input.commandType, input.payloadHash)
        .run();
      const row = await this.database
        .prepare(
          'SELECT game_id, command_id, actor_id, command_type, payload_hash, status, result_status, result_json, result_transaction_id FROM command_ledger WHERE game_id = ? AND command_id = ?',
        )
        .bind(input.gameId, input.commandId)
        .first<CommandLedgerRow>();
      if (row === null)
        throw new DatabaseError({
          operation: 'claimCommand',
          cause: new Error('Command was not persisted.'),
        });
      const entry = mapEntry(row);
      if (
        entry.actorId !== input.actorId ||
        entry.commandType !== input.commandType ||
        entry.payloadHash !== input.payloadHash
      )
        throw new ConflictError(
          'COMMAND_ID_REUSED',
          'This command ID belongs to a different command.',
        );
      return entry;
    } catch (cause) {
      if (cause instanceof ConflictError || cause instanceof DatabaseError) throw cause;
      throw new DatabaseError({ operation: 'claimCommand', cause });
    }
  }
  async complete(input: {
    gameId: string;
    commandId: string;
    status: number;
    result: unknown;
    transactionId: string | null;
  }): Promise<void> {
    try {
      await this.database
        .prepare(
          "UPDATE command_ledger SET status = 'COMPLETED', result_status = ?, result_json = ?, result_transaction_id = ?, completed_at = CURRENT_TIMESTAMP WHERE game_id = ? AND command_id = ? AND status = 'PENDING'",
        )
        .bind(
          input.status,
          JSON.stringify(input.result),
          input.transactionId,
          input.gameId,
          input.commandId,
        )
        .run();
    } catch (cause) {
      throw new DatabaseError({ operation: 'completeCommand', cause });
    }
  }
}
interface CommandLedgerRow {
  game_id: string;
  command_id: string;
  actor_id: string;
  command_type: string;
  payload_hash: string;
  status: 'PENDING' | 'COMPLETED';
  result_status: number | null;
  result_json: string | null;
  result_transaction_id: string | null;
}
function mapEntry(row: CommandLedgerRow): CommandLedgerEntry {
  return {
    gameId: row.game_id,
    commandId: row.command_id,
    actorId: row.actor_id,
    commandType: row.command_type,
    payloadHash: row.payload_hash,
    status: row.status,
    resultStatus: row.result_status,
    resultJson: row.result_json,
    resultTransactionId: row.result_transaction_id,
  };
}
