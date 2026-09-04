import { describe, expect, it } from 'vitest';

import {
  allToPlayer,
  bankToPlayer,
  InsufficientFundsError,
  InvalidAmountError,
  passGo,
  playerToAll,
  playerToBank,
  playerToPlayer,
} from './banking.js';
import type { Game, Player } from '../types/monopoly.js';

const game: Game = {
  id: 'game-1',
  name: 'Friday game',
  startingBalance: 1500,
  passGoReward: 200,
  currency: 'K',
  status: 'ACTIVE',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function createPlayers(balances: readonly number[] = [1500, 1500, 1500]): Player[] {
  return balances.map((balance, index) => ({
    id: `player-${index + 1}`,
    gameId: game.id,
    name: `Player ${index + 1}`,
    color: `color-${index + 1}`,
    balance,
    createdAt: '2026-01-01T00:00:00.000Z',
  }));
}

function balances(result: ReturnType<typeof playerToPlayer>): number[] {
  return result.affectedPlayers.map((change) => change.balanceAfter);
}

describe('banking domain operations', () => {
  it('transfers money between players and creates a transaction draft', () => {
    const result = playerToPlayer({
      game,
      players: createPlayers(),
      sourcePlayerId: 'player-1',
      destinationPlayerId: 'player-2',
      amount: 125,
      comment: 'Trade',
    });

    expect(balances(result)).toEqual([1375, 1625]);
    expect(result.transaction).toEqual({
      gameId: game.id,
      type: 'PLAYER_TO_PLAYER',
      amount: 125,
      totalAmount: 125,
      comment: 'Trade',
      participants: [
        { playerId: 'player-1', balanceDelta: -125 },
        { playerId: 'player-2', balanceDelta: 125 },
      ],
    });
  });

  it('rejects a player-to-player transfer when funds are insufficient', () => {
    const players = createPlayers([50, 1500]);

    expect(() =>
      playerToPlayer({
        game,
        players,
        sourcePlayerId: 'player-1',
        destinationPlayerId: 'player-2',
        amount: 100,
      }),
    ).toThrow(InsufficientFundsError);

    try {
      playerToPlayer({
        game,
        players,
        sourcePlayerId: 'player-1',
        destinationPlayerId: 'player-2',
        amount: 100,
      });
    } catch (error) {
      expect(error).toMatchObject({
        playerId: 'player-1',
        currentBalance: 50,
        requiredAmount: 100,
        shortfall: 50,
      });
    }
    expect(players.map((player) => player.balance)).toEqual([50, 1500]);
  });

  it('removes money from a player when paying the bank', () => {
    const result = playerToBank({
      game,
      players: createPlayers(),
      playerId: 'player-1',
      amount: 300,
    });

    expect(balances(result)).toEqual([1200]);
    expect(result.transaction.type).toBe('PLAYER_TO_BANK');
  });

  it('adds unlimited bank funds to a player', () => {
    const result = bankToPlayer({
      game,
      players: createPlayers(),
      playerId: 'player-1',
      amount: 300,
    });

    expect(balances(result)).toEqual([1800]);
    expect(result.transaction.type).toBe('BANK_TO_PLAYER');
  });

  it('pays every other player from one payer atomically', () => {
    const result = playerToAll({
      game,
      players: createPlayers(),
      payerPlayerId: 'player-1',
      amountPerPlayer: 100,
    });

    expect(balances(result)).toEqual([1300, 1600, 1600]);
    expect(result.transaction).toMatchObject({
      type: 'PLAYER_TO_ALL',
      amount: 100,
      totalAmount: 200,
    });
  });

  it('rejects player-to-all when the payer cannot cover the full total without mutation', () => {
    const players = createPlayers([150, 1500, 1500]);

    expect(() =>
      playerToAll({
        game,
        players,
        payerPlayerId: 'player-1',
        amountPerPlayer: 100,
      }),
    ).toThrow(InsufficientFundsError);
    expect(players.map((player) => player.balance)).toEqual([150, 1500, 1500]);
  });

  it('collects an equal payment from every other player', () => {
    const result = allToPlayer({
      game,
      players: createPlayers(),
      recipientPlayerId: 'player-1',
      amountPerPlayer: 100,
    });

    expect(balances(result)).toEqual([1400, 1400, 1700]);
    expect(result.transaction).toMatchObject({
      type: 'ALL_TO_PLAYER',
      amount: 100,
      totalAmount: 200,
    });
  });

  it('rejects all-to-player when one payer cannot afford it without mutation', () => {
    const players = createPlayers([1500, 50, 1500]);

    expect(() =>
      allToPlayer({
        game,
        players,
        recipientPlayerId: 'player-1',
        amountPerPlayer: 100,
      }),
    ).toThrow(InsufficientFundsError);
    expect(players.map((player) => player.balance)).toEqual([1500, 50, 1500]);
  });

  it('awards the configured Pass GO reward', () => {
    const result = passGo({
      game,
      players: createPlayers(),
      playerId: 'player-1',
    });

    expect(balances(result)).toEqual([1700]);
    expect(result.transaction).toMatchObject({
      type: 'PASS_GO',
      amount: 200,
      totalAmount: 200,
    });
  });

  it.each([0, -10])('rejects invalid amount %i', (amount) => {
    expect(() =>
      playerToBank({
        game,
        players: createPlayers(),
        playerId: 'player-1',
        amount,
      }),
    ).toThrow(InvalidAmountError);
  });

  it('never produces a negative balance', () => {
    const result = playerToBank({
      game,
      players: createPlayers([100, 1500]),
      playerId: 'player-1',
      amount: 100,
    });

    expect(balances(result)).toEqual([0]);
    expect(result.affectedPlayers.every((change) => change.balanceAfter >= 0)).toBe(true);
  });
});
