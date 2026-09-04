import type { Player } from '../types/monopoly.js';

/**
 * Monopoly Bank's custom table rule, not official Monopoly scoring:
 * finish when at most two players remain active, or when at least two players
 * are bankrupt. Every active player at that point is a winner.
 */
export function calculateWinners(players: readonly Player[]): Player[] {
  const active = players.filter((player) => player.status !== 'BANKRUPT');
  const bankruptCount = players.length - active.length;
  if (active.length === 0 || (active.length > 2 && bankruptCount < 2)) return [];
  return active;
}
