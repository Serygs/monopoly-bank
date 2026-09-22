import { describe, expect, it } from 'vitest';
import type { LedgerStatistics } from '../../shared/contracts/api.js';
import type { Player } from '../../shared/types/monopoly.js';
import { classicSpaces, emptyClassicProperties } from '../classic-board.test-support.js';
import { withNetWorth, withPropertySnapshot } from './property-statistics.js';

const gameId = '00000000-0000-4000-8000-0000000000a1';
function player(id: string, balance: number): Player { return { id, gameId, name: id, color: '#1', balance, status: 'ACTIVE', createdAt: '' }; }
const players = [player('ada', 1000), player('lin', 1200), player('kim', 1100)];
const statistics: LedgerStatistics = { durationMs: 0, totalTransactions: 0, totalMoneyTransferred: 0, largestSinglePayment: 0, richestActivePlayer: null, lowestActiveBalance: null, players: [], playerToPlayerTotal: 0, paidToBank: 0, receivedFromBank: 0, largestTransaction: 0, biggestSenderId: null, leastSenderId: null, biggestPayerRecipient: null, cashLeaderboard: [] };

// Boardwalk (400, house 200) with a hotel, Park Place (350) mortgaged, Reading Railroad (200) clear.
const properties = emptyClassicProperties().map((property) => {
  if (property.boardSpaceId === 'board-classic-space-39') return { ...property, ownerPlayerId: 'ada', houses: 5 };
  if (property.boardSpaceId === 'board-classic-space-37') return { ...property, ownerPlayerId: 'ada', mortgaged: true };
  if (property.boardSpaceId === 'board-classic-space-05') return { ...property, ownerPlayerId: 'kim' };
  return property;
});

describe('property statistics adapter', () => {
  it('ranks capital as cash plus clear deeds plus half of mortgaged deeds plus buildings at cost, richest first', () => {
    const ranked = withNetWorth(statistics, { players, boardSpaces: classicSpaces, properties });
    expect(ranked.netWorth?.map((entry) => [entry.player.id, entry.netWorth])).toEqual([
      ['ada', 1000 + 400 + 5 * 200 + 175],
      ['kim', 1100 + 200],
      ['lin', 1200],
    ]);
    expect(ranked).not.toHaveProperty('propertyOwnership');
  });

  it('leaves the statistics of a game without a board untouched and without the field', () => {
    const plain = withNetWorth(statistics, { players });
    expect(plain).toBe(statistics);
    expect(plain).not.toHaveProperty('netWorth');
    expect(withPropertySnapshot(statistics, { players })).not.toHaveProperty('propertyOwnership');
  });

  it('adds the deed table beside the ranking for the final snapshot of a board game', () => {
    const snapshot = withPropertySnapshot(statistics, { players, boardSpaces: classicSpaces, properties });
    expect(snapshot.netWorth?.[0].player.id).toBe('ada');
    expect(snapshot.propertyOwnership).toHaveLength(28);
    expect(snapshot.propertyOwnership?.find((deed) => deed.boardSpaceId === 'board-classic-space-39')).toEqual({ boardSpaceId: 'board-classic-space-39', ownerPlayerId: 'ada', houses: 5, mortgaged: false });
  });
});
