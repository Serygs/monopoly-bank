import type { PlayerBalanceChange, PendingTransaction } from '../../shared/domain/banking.js';
import type { BuildingBankDelta, PropertyChange } from '../../shared/domain/property.js';
import type { GameProperty } from '../../shared/types/monopoly.js';
import { DatabaseError, PersistenceConsistencyError } from '../services/errors.js';

/** One deed write: the row the domain wants, and the row it was computed from. */
export interface PropertyStateWrite {
  previous: GameProperty;
  change: PropertyChange;
}

export interface PersistBankingOperationInput {
  transactionId: string;
  transaction: PendingTransaction;
  balanceChanges: readonly PlayerBalanceChange[];
  bankruptPlayerId?: string;
  recentAmount?: number;
  propertyChanges?: readonly PropertyStateWrite[];
  buildingBankDelta?: BuildingBankDelta;
  jailChange?: { playerId: string; isInJail: boolean };
  tradeSettlement?: { tradeId: string };
  paymentRequestSettlement?: { requestId: string };
}

export interface BankingOperationRepository {
  persist(input: PersistBankingOperationInput): Promise<void>;
}

/**
 * Every state a banking operation touches — deeds, the building bank, the jail
 * flag, the offer it settles, the balances and the transaction that records it
 * — is written in one `database.batch`, so D1 commits all of it or none of it.
 *
 * Each deed and each balance is written compare-and-set: the statement matches
 * the row only in the state the domain computed from, and forces a CHECK
 * violation otherwise, so a concurrent change between read and write makes the
 * whole batch fail rather than land half of it. A deed row that vanished is the
 * one case a CHECK cannot catch; `meta.changes` reports it afterwards.
 */
export class D1BankingOperationRepository implements BankingOperationRepository {
  private readonly database: D1Database;

  constructor(database: D1Database) {
    this.database = database;
  }

  async persist(input: PersistBankingOperationInput): Promise<void> {
    const gameId = input.transaction.gameId;
    const propertyStatements = (input.propertyChanges ?? []).map((write) => propertyUpdateStatement(this.database, gameId, write));
    const bankStatements = buildingBankStatements(this.database, gameId, input.buildingBankDelta);
    const jailStatements = input.jailChange === undefined ? [] : [this.database.prepare('UPDATE players SET is_in_jail = ? WHERE id = ? AND game_id = ?').bind(input.jailChange.isInJail ? 1 : 0, input.jailChange.playerId, gameId)];
    const tradeStatements = input.tradeSettlement === undefined ? [] : [tradeSettlementStatement(this.database, gameId, input.tradeSettlement.tradeId, input.transactionId)];
    const paymentRequestStatements = input.paymentRequestSettlement === undefined ? [] : [paymentRequestSettlementStatement(this.database, gameId, input.paymentRequestSettlement.requestId, input.transactionId)];
    const balanceStatement = createBalanceUpdateStatement(this.database, input.balanceChanges);
    const transactionStatement = this.database
      .prepare(
        `INSERT INTO transactions (id, game_id, type, amount, total_amount, comment)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.transactionId,
        gameId,
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
          gameId,
          participant.playerId,
          participant.balanceDelta,
        ),
    );

    const statusStatement = input.bankruptPlayerId === undefined ? [] : [this.database.prepare("UPDATE players SET status = 'BANKRUPT', balance = 0 WHERE id = ? AND game_id = ? AND status = 'ACTIVE'").bind(input.bankruptPlayerId, gameId)];
    let results: D1Result[];
    try {
      const recentStatements = input.recentAmount === undefined ? [] : recentAmountStatements(this.database, gameId, input.recentAmount);
      results = await this.database.batch([
        ...propertyStatements,
        ...bankStatements,
        ...jailStatements,
        ...tradeStatements,
        ...paymentRequestStatements,
        balanceStatement,
        transactionStatement,
        ...participantStatements,
        ...statusStatement,
        ...recentStatements,
      ]);
    } catch (cause) {
      throw new DatabaseError({ operation: 'persistBankingOperation', cause });
    }

    // The CAS statements lead the batch, so their results are the first entries.
    const guarded = propertyStatements.length + bankStatements.length + jailStatements.length + tradeStatements.length + paymentRequestStatements.length;
    for (let index = 0; index < guarded; index += 1) {
      const changes = results[index]?.meta?.changes;
      if (changes !== undefined && changes === 0) throw new PersistenceConsistencyError();
    }
  }
}

/**
 * Compare-and-set on the deed. SQLite evaluates the SET expressions against the
 * row as it was before the update, so the CASE sees the stored state: when it
 * still matches what the domain read, the new level is written; when it has
 * moved on, `houses` is forced to -1, the table's `CHECK (houses BETWEEN 0 AND 5)`
 * rejects it, and D1 rolls the whole batch back. Filtering the stale row out in
 * WHERE instead would let the rest of the batch commit around a silent no-op.
 */
function propertyUpdateStatement(database: D1Database, gameId: string, write: PropertyStateWrite): D1PreparedStatement {
  const { previous, change } = write;
  return database.prepare(
    `UPDATE game_properties
     SET owner_player_id = ?,
         houses = CASE WHEN owner_player_id IS ? AND houses = ? AND mortgaged = ? THEN ? ELSE -1 END,
         mortgaged = ?
     WHERE game_id = ? AND board_space_id = ?`,
  ).bind(
    change.ownerPlayerId,
    previous.ownerPlayerId, previous.houses, previous.mortgaged ? 1 : 0, change.houses,
    change.mortgaged ? 1 : 0,
    gameId, change.boardSpaceId,
  );
}

/** The bank's `CHECK (>= 0)` columns are the guard: taking more buildings than remain fails the batch. */
function buildingBankStatements(database: D1Database, gameId: string, delta: BuildingBankDelta | undefined): D1PreparedStatement[] {
  if (delta === undefined || (delta.houses === 0 && delta.hotels === 0)) return [];
  return [database.prepare('UPDATE game_building_banks SET houses_available = houses_available + ?, hotels_available = hotels_available + ? WHERE game_id = ?').bind(delta.houses, delta.hotels, gameId)];
}

/** Settles a pending, unexpired trade; any other state is forced into a value the `state` CHECK rejects, failing the batch. */
function tradeSettlementStatement(database: D1Database, gameId: string, tradeId: string, transactionId: string): D1PreparedStatement {
  return database.prepare(
    `UPDATE property_trades
     SET state = CASE WHEN state = 'PENDING' AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now') THEN 'ACCEPTED' ELSE 'SETTLED_TWICE' END,
         resolved_at = CURRENT_TIMESTAMP, transaction_id = ?
     WHERE game_id = ? AND id = ?`,
  ).bind(transactionId, gameId, tradeId);
}

/** The same guard for a payment request: only a pending, unexpired one can carry the settling transaction. */
function paymentRequestSettlementStatement(database: D1Database, gameId: string, requestId: string, transactionId: string): D1PreparedStatement {
  return database.prepare(
    `UPDATE payment_requests
     SET state = CASE WHEN state = 'PENDING' AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now') THEN 'ACCEPTED' ELSE 'SETTLED_TWICE' END,
         resolved_at = CURRENT_TIMESTAMP, transaction_id = ?
     WHERE game_id = ? AND id = ?`,
  ).bind(transactionId, gameId, requestId);
}

function recentAmountStatements(database: D1Database, gameId: string, amount: number): D1PreparedStatement[] { return [database.prepare('DELETE FROM game_recent_amounts WHERE game_id = ? AND amount = ?').bind(gameId, amount), database.prepare('INSERT INTO game_recent_amounts (game_id, amount, used_at) VALUES (?, ?, CURRENT_TIMESTAMP)').bind(gameId, amount), database.prepare('DELETE FROM game_recent_amounts WHERE game_id = ? AND amount NOT IN (SELECT amount FROM game_recent_amounts WHERE game_id = ? ORDER BY used_at DESC, amount DESC LIMIT 5)').bind(gameId, gameId)]; }

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
