import type { PlayerBalanceChange } from '../../shared/domain/banking.js';

export interface BalanceGuard {
  condition: string;
  value: string;
}

export function guardedBalanceUpdate(
  database: D1Database,
  balanceChanges: readonly PlayerBalanceChange[],
  guard?: BalanceGuard,
): D1PreparedStatement {
  const gameId = balanceChanges[0]?.player.gameId;
  if (gameId === undefined && balanceChanges.length === 0) {
    return database.prepare('SELECT 1');
  }
  if (gameId === undefined || balanceChanges.some((change) => change.player.gameId !== gameId)) {
    throw new Error('All balance changes must belong to the same game.');
  }

  const condition = guard === undefined ? 'balance = ?' : `balance = ? AND ${guard.condition}`;
  const cases = balanceChanges.map(() => `WHEN ? THEN CASE WHEN ${condition} THEN ? ELSE -1 END`);
  const values: (string | number)[] = [];
  for (const change of balanceChanges) {
    values.push(change.player.id, change.balanceBefore);
    if (guard !== undefined) values.push(guard.value);
    values.push(change.balanceAfter);
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
