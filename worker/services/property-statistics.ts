import type { GameDetails, LedgerStatistics } from '../../shared/contracts/api.js';
import { netWorthRanking } from '../../shared/domain/net-worth.js';

/** The part of a game's details the capital metric reads: the wallets, the catalogue and who holds what. */
export type PropertyStatisticsSource = Pick<GameDetails, 'players' | 'boardSpaces' | 'properties'>;

/**
 * A thin adapter from the pure `netWorthRanking` rule to the ledger statistics
 * the API answers with. A game without a board has no catalogue to price deeds
 * against, so the statistics come back untouched and the field stays absent.
 * `winner-calculation.ts` is not consulted here and does not read this.
 */
export function withNetWorth<T extends LedgerStatistics>(statistics: T, source: PropertyStatisticsSource): T {
  if (source.boardSpaces === undefined || source.properties === undefined) return statistics;
  return { ...statistics, netWorth: netWorthRanking(source.players, source.boardSpaces, source.properties) };
}

/**
 * What the final snapshot of a board game keeps beyond the ledger figures: the
 * capital ranking and the deed table as they stood at the moment of finishing.
 * The client gets exactly this back from `GET …/summary` once the game is over.
 */
export function withPropertySnapshot<T extends LedgerStatistics>(statistics: T, source: PropertyStatisticsSource): T {
  const ranked = withNetWorth(statistics, source);
  if (source.properties === undefined) return ranked;
  return { ...ranked, propertyOwnership: source.properties.map((property) => ({ boardSpaceId: property.boardSpaceId, ownerPlayerId: property.ownerPlayerId, houses: property.houses, mortgaged: property.mortgaged })) };
}
