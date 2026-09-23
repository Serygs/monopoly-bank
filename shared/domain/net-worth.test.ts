import { describe, expect, it } from 'vitest';

import { netWorth, netWorthRanking } from './net-worth.js';
import type { BoardSpace, Game, GameProperty, Player } from '../types/monopoly.js';

const game: Game = {
  id: 'game-1',
  name: 'Friday game',
  startingBalance: 1500,
  passGoReward: 200,
  currency: 'UAH',
  paymentMode: 'FAST',
  status: 'ACTIVE',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const spaces: BoardSpace[] = [
  street('board-classic-space-01', 1, 60, 30, 50),
  street('board-classic-space-03', 3, 60, 30, 50),
  { id: 'board-classic-space-05', boardIndex: 5, kind: 'RAILROAD', colorGroup: 'RAILROAD', translationKey: 'r', customName: null, price: 200, mortgageValue: 100, houseCost: null, rents: [25, 50, 100, 200] },
  { id: 'board-classic-space-12', boardIndex: 12, kind: 'UTILITY', colorGroup: 'UTILITY', translationKey: 'u', customName: null, price: 150, mortgageValue: 75, houseCost: null, rents: [] },
];

function street(id: string, boardIndex: number, price: number, mortgageValue: number, houseCost: number): BoardSpace {
  return { id, boardIndex, kind: 'STREET', colorGroup: 'BROWN', translationKey: id, customName: null, price, mortgageValue, houseCost, rents: [2, 10, 30, 90, 160, 250] };
}

function createPlayers(balances: readonly number[]): Player[] {
  return balances.map((balance, index) => ({
    id: `player-${index + 1}`,
    gameId: game.id,
    name: `Player ${index + 1}`,
    color: `color-${index + 1}`,
    balance,
    createdAt: '2026-01-01T00:00:00.000Z',
  }));
}

function owned(boardSpaceId: string, ownerPlayerId: string, houses = 0, mortgaged = false): GameProperty {
  return { boardSpaceId, ownerPlayerId, houses, mortgaged };
}

describe('net worth', () => {
  it('adds cash, clear deeds at full price, mortgaged deeds at half, and buildings at cost', () => {
    const [player, rival] = createPlayers([500, 500]);
    const properties = [
      owned('board-classic-space-01', 'player-1', 3),
      owned('board-classic-space-12', 'player-1', 0, true),
      owned('board-classic-space-05', 'player-1'),
      owned('board-classic-space-03', 'player-2'),
    ];

    // 500 cash + (60 + 3 x 50) + floor(150 / 2) + 200 = 985.
    expect(netWorth(player, spaces, properties)).toBe(985);
    expect(netWorth(rival, spaces, properties)).toBe(560);
  });

  it('is exactly the cash balance for a player who owns nothing', () => {
    const [player] = createPlayers([1500]);

    expect(netWorth(player, spaces, [])).toBe(1500);
  });

  it('values a hotel as the five buildings its level stands for', () => {
    const [player] = createPlayers([0]);

    expect(netWorth(player, spaces, [owned('board-classic-space-01', 'player-1', 5)])).toBe(310);
  });

  it('ignores an ownership row for a space this board does not catalogue', () => {
    const [player] = createPlayers([100]);

    expect(netWorth(player, spaces, [owned('space-from-another-board', 'player-1')])).toBe(100);
  });
});

describe('net worth ranking', () => {
  it('orders players richest first', () => {
    const players = createPlayers([100, 900, 400]);
    const properties = [owned('board-classic-space-01', 'player-1', 4)];

    // player-1: 100 + 60 + 200 = 360.
    expect(netWorthRanking(players, spaces, properties).map((entry) => [entry.player.id, entry.netWorth])).toEqual([
      ['player-2', 900],
      ['player-3', 400],
      ['player-1', 360],
    ]);
  });

  it('keeps players that tie in the order they were given', () => {
    const players = createPlayers([500, 500, 500]);

    expect(netWorthRanking(players, spaces, []).map((entry) => entry.player.id)).toEqual(['player-1', 'player-2', 'player-3']);
  });
});
