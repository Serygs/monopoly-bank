import type { BoardSpace, GameProperty, Player } from '../types/monopoly.js';

/**
 * Total capital, the metric the table uses to compare positions. It is only a
 * metric: `winner-calculation.ts` decides who wins and does not read this.
 *
 * A deed counts at its catalogue price while it is clear and at half that price
 * while it is mortgaged — on every canonical board that half is exactly the
 * mortgage value. Buildings count at what they cost, not at what the bank would
 * pay back for them, and a mortgaged deed can never carry any.
 */
export interface NetWorthEntry {
  player: Player;
  netWorth: number;
}

export function netWorth(
  player: Player,
  spaces: readonly BoardSpace[],
  properties: readonly GameProperty[],
): number {
  return properties
    .filter((property) => property.ownerPlayerId === player.id)
    .reduce((total, property) => total + deedValue(spaces, property), player.balance);
}

/**
 * Every player by capital, richest first. Ties keep the order they were given
 * in, so a caller that passes players in seat order gets a stable table.
 */
export function netWorthRanking(
  players: readonly Player[],
  spaces: readonly BoardSpace[],
  properties: readonly GameProperty[],
): NetWorthEntry[] {
  return players
    .map((player) => ({ player, netWorth: netWorth(player, spaces, properties) }))
    .sort((left, right) => right.netWorth - left.netWorth);
}

function deedValue(spaces: readonly BoardSpace[], property: GameProperty): number {
  const space = spaces.find((candidate) => candidate.id === property.boardSpaceId);
  if (space === undefined) {
    return 0;
  }

  const deed = property.mortgaged ? Math.floor(space.price / 2) : space.price;
  return deed + (space.houseCost ?? 0) * property.houses;
}
