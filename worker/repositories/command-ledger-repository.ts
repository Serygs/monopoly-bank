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

type CommandClaim = Omit<
  CommandLedgerEntry,
  'status' | 'resultStatus' | 'resultJson' | 'resultTransactionId'
>;

export class D1CommandLedgerRepository implements CommandLedgerRepository {
  private readonly database: D1Database;
  private readonly claims = new Map<string, CommandClaim>();
  constructor(database: D1Database) {
    this.database = database;
  }
  async claim(input: CommandClaim): Promise<CommandLedgerEntry> {
    try {
      const row = await this.database
        .prepare(
          'SELECT game_id, command_id, actor_id, command_type, payload_hash, status, result_status, result_json, result_transaction_id FROM command_ledger WHERE game_id = ? AND command_id = ?',
        )
        .bind(input.gameId, input.commandId)
        .first<CommandLedgerRow>();
      const entry: CommandLedgerEntry =
        row === null
          ? {
              ...input,
              status: 'PENDING',
              resultStatus: null,
              resultJson: null,
              resultTransactionId: null,
            }
          : mapEntry(row);
      if (
        entry.actorId !== input.actorId ||
        entry.commandType !== input.commandType ||
        entry.payloadHash !== input.payloadHash
      )
        throw new ConflictError(
          'COMMAND_ID_REUSED',
          'This command ID belongs to a different command.',
        );
      if (entry.status === 'PENDING') this.claims.set(claimKey(input), input);
      return entry;
    } catch (cause) {
      if (cause instanceof ConflictError) throw cause;
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
    const claim = this.claims.get(claimKey(input));
    try {
      if (claim === undefined) {
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
        return;
      }
      await this.database
        .prepare(
          `INSERT INTO command_ledger (game_id, command_id, actor_id, command_type, payload_hash, status, result_status, result_json, result_transaction_id, completed_at)
           VALUES (?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(game_id, command_id) DO UPDATE SET status = 'COMPLETED', result_status = excluded.result_status, result_json = excluded.result_json, result_transaction_id = excluded.result_transaction_id, completed_at = excluded.completed_at
           WHERE command_ledger.status = 'PENDING'`,
        )
        .bind(
          claim.gameId,
          claim.commandId,
          claim.actorId,
          claim.commandType,
          claim.payloadHash,
          input.status,
          JSON.stringify(input.result),
          input.transactionId,
        )
        .run();
      this.claims.delete(claimKey(input));
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
function claimKey(input: { gameId: string; commandId: string }): string {
  return `${input.gameId}\u0000${input.commandId}`;
}
