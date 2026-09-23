import { describe, expect, it } from 'vitest';

import { applyDiceRoll, payJailBail, PlayerNotInJailError, type DiceRoll } from './jail.js';
import { InsufficientFundsError } from './banking.js';
import { applyDiceResult } from '../../src/utils/dice.js';
import type { BoardDefinition, Game, Player } from '../types/monopoly.js';

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

const board: BoardDefinition = {
  id: 'board-classic',
  name: 'Classic',
  jailFee: 50,
  unmortgageInterestPercent: 10,
  houseBankLimit: 32,
  hotelBankLimit: 12,
  utilityMultiplierSingle: 4,
  utilityMultiplierPair: 10,
};

const double: DiceRoll = { first: 4, second: 4, total: 8, isDouble: true };
const plain: DiceRoll = { first: 1, second: 2, total: 3, isDouble: false };

function createPlayers(balances: readonly number[] = [1500, 1500], jailed: readonly boolean[] = [true, false]): Player[] {
  return balances.map((balance, index) => ({
    id: `player-${index + 1}`,
    gameId: game.id,
    name: `Player ${index + 1}`,
    color: `color-${index + 1}`,
    balance,
    isInJail: jailed[index],
    createdAt: '2026-01-01T00:00:00.000Z',
  }));
}

describe('the three-doubles rule', () => {
  it('counts consecutive doubles and jails on the third', () => {
    expect(applyDiceRoll(0, double)).toEqual({ consecutiveDoubles: 1, isInJail: false, thirdDouble: false });
    expect(applyDiceRoll(1, double)).toEqual({ consecutiveDoubles: 2, isInJail: false, thirdDouble: false });
    expect(applyDiceRoll(2, double)).toEqual({ consecutiveDoubles: 0, isInJail: true, thirdDouble: true });
  });

  it('breaks the streak on any roll that is not a double', () => {
    expect(applyDiceRoll(2, plain)).toEqual({ consecutiveDoubles: 0, isInJail: false, thirdDouble: false });
  });

  it('is the very function the client rolls with, not a second copy of the rule', () => {
    expect(applyDiceResult).toBe(applyDiceRoll);
  });
});

describe('paying bail', () => {
  it('pays the board jail fee to the bank and takes the flag off', () => {
    const players = createPlayers();

    const result = payJailBail({ game, players, board, playerId: 'player-1' });

    expect(result.transaction).toEqual({
      gameId: 'game-1',
      type: 'JAIL_BAIL',
      amount: 50,
      totalAmount: 50,
      comment: null,
      participants: [{ playerId: 'player-1', balanceDelta: -50 }],
    });
    expect(result.affectedPlayers.map((change) => change.balanceAfter)).toEqual([1450]);
    expect(result.jailChange).toEqual({ playerId: 'player-1', isInJail: false });
    expect(players.map((player) => player.balance)).toEqual([1500, 1500]);
  });

  it('refuses bail for a player who is not in jail', () => {
    expect(() => payJailBail({ game, players: createPlayers(), board, playerId: 'player-2' })).toThrow(PlayerNotInJailError);
  });

  it('refuses bail the player cannot afford', () => {
    expect(() => payJailBail({ game, players: createPlayers([40, 1500]), board, playerId: 'player-1' })).toThrow(InsufficientFundsError);
  });

  it('charges whatever the board sets the fee at', () => {
    const result = payJailBail({ game, players: createPlayers(), board: { ...board, jailFee: 75 }, playerId: 'player-1' });

    expect(result.transaction).toMatchObject({ type: 'JAIL_BAIL', amount: 75, totalAmount: 75 });
  });
});
