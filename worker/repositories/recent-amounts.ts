import { addRecentAmount } from '../../shared/domain/recent-amounts.js';

export async function readRecentAmounts(database: D1Database, gameId: string): Promise<number[]> {
  const row = await database
    .prepare('SELECT recent_amounts FROM games WHERE id = ?')
    .bind(gameId)
    .first<{ recent_amounts: string | null }>();
  if (row !== null && row.recent_amounts !== null)
    return JSON.parse(row.recent_amounts) as number[];
  const legacy = await database
    .prepare(
      'SELECT amount FROM game_recent_amounts WHERE game_id = ? ORDER BY used_at DESC, amount DESC LIMIT 5',
    )
    .bind(gameId)
    .all<{ amount: number }>();
  return legacy.results.map((entry) => entry.amount);
}

export async function recentAmountStatement(
  database: D1Database,
  gameId: string,
  amount: number,
): Promise<D1PreparedStatement> {
  const amounts = addRecentAmount(await readRecentAmounts(database, gameId), amount);
  return database
    .prepare('UPDATE games SET recent_amounts = ? WHERE id = ?')
    .bind(JSON.stringify(amounts), gameId);
}
