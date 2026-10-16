import { describe, expect, it } from 'vitest';
import type { Game, Mortgage, Player } from '../types/monopoly.js';
import { defaultGameRules } from '../types/monopoly.js';
import {
  InsufficientFundsError,
  InvalidAmountError,
  InvalidGameStateError,
  InvalidPropertyNameError,
  mortgageProperty,
  MortgageNotFoundError,
  PlayerBankruptError,
  redeemMortgage,
} from './banking.js';

const game: Game = {
  id: 'game-1',
  name: 'Friday game',
  startingBalance: 1500,
  passGoReward: 200,
  currency: 'K',
  paymentMode: 'FAST',
  rules: defaultGameRules,
  settings: null,
  status: 'ACTIVE',
  createdAt: '',
  updatedAt: '',
};

function players(balances: readonly number[], overrides: Partial<Player>[] = []): Player[] {
  return balances.map((balance, index) => ({
    id: `player-${index + 1}`,
    gameId: game.id,
    name: `Player ${index + 1}`,
    color: `color-${index + 1}`,
    balance,
    createdAt: '',
    ...overrides[index],
  }));
}

const mortgage: Mortgage = {
  id: 'mortgage-1',
  gameId: game.id,
  playerId: 'player-1',
  propertyName: 'Boardwalk',
  mortgageValue: 1_200_000,
  createdAt: '',
};

describe('mortgageProperty', () => {
  it('pays the mortgage value from the bank and keeps the property name', () => {
    const result = mortgageProperty({
      game,
      players: players([500, 500]),
      playerId: 'player-1',
      propertyName: '  Park   Place ',
      amount: 350,
    });

    expect(result.affectedPlayers.map((change) => change.balanceAfter)).toEqual([850]);
    expect(result.transaction).toEqual({
      gameId: game.id,
      type: 'MORTGAGE',
      amount: 350,
      totalAmount: 350,
      comment: 'Park Place',
      participants: [{ playerId: 'player-1', balanceDelta: 350 }],
      newMortgage: { playerId: 'player-1', propertyName: 'Park Place', mortgageValue: 350 },
    });
  });

  it('rejects an invalid name or amount without changing a balance', () => {
    const state = players([500, 500]);
    const command = { game, players: state, playerId: 'player-1' };
    expect(() => mortgageProperty({ ...command, propertyName: '   ', amount: 10 })).toThrow(
      InvalidPropertyNameError,
    );
    expect(() =>
      mortgageProperty({ ...command, propertyName: 'x'.repeat(61), amount: 10 }),
    ).toThrow(InvalidPropertyNameError);
    for (const amount of [0, -5, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect(() => mortgageProperty({ ...command, propertyName: 'Boardwalk', amount })).toThrow(
        InvalidAmountError,
      );
    expect(state.map((player) => player.balance)).toEqual([500, 500]);
  });

  it('refuses a value whose redemption could not be paid back as a safe integer', () => {
    expect(() =>
      mortgageProperty({
        game,
        players: players([500, 500]),
        playerId: 'player-1',
        propertyName: 'Boardwalk',
        amount: Number.MAX_SAFE_INTEGER,
      }),
    ).toThrow(InvalidAmountError);
  });

  it('rejects a bankrupt player and a game that is not active', () => {
    expect(() =>
      mortgageProperty({
        game,
        players: players([0, 500], [{ status: 'BANKRUPT' }]),
        playerId: 'player-1',
        propertyName: 'Boardwalk',
        amount: 10,
      }),
    ).toThrow(PlayerBankruptError);
    expect(() =>
      mortgageProperty({
        game: { ...game, status: 'FINISHED' },
        players: players([500, 500]),
        playerId: 'player-1',
        propertyName: 'Boardwalk',
        amount: 10,
      }),
    ).toThrow(InvalidGameStateError);
  });
});

describe('redeemMortgage', () => {
  it('charges the mortgage value plus 10% and closes that mortgage', () => {
    const result = redeemMortgage({
      game,
      players: players([2_000_000, 500]),
      playerId: 'player-1',
      mortgage,
    });

    expect(result.affectedPlayers.map((change) => change.balanceAfter)).toEqual([680_000]);
    expect(result.transaction).toEqual({
      gameId: game.id,
      type: 'MORTGAGE_REDEMPTION',
      amount: 1_320_000,
      totalAmount: 1_320_000,
      comment: 'Boardwalk',
      participants: [{ playerId: 'player-1', balanceDelta: -1_320_000 }],
      redeemedMortgageId: 'mortgage-1',
    });
  });

  it('rounds the cost half up to a whole amount', () => {
    const result = redeemMortgage({
      game,
      players: players([100, 500]),
      playerId: 'player-1',
      mortgage: { ...mortgage, mortgageValue: 15 },
    });
    expect(result.transaction.amount).toBe(17);
  });

  it('rejects the redemption when the player cannot afford it, changing nothing', () => {
    const state = players([1_000_000, 500]);
    expect(() => redeemMortgage({ game, players: state, playerId: 'player-1', mortgage })).toThrow(
      InsufficientFundsError,
    );
    expect(state.map((player) => player.balance)).toEqual([1_000_000, 500]);
  });

  it("rejects redeeming another player's mortgage or one from another game", () => {
    expect(() =>
      redeemMortgage({
        game,
        players: players([2_000_000, 2_000_000]),
        playerId: 'player-2',
        mortgage,
      }),
    ).toThrow(MortgageNotFoundError);
    expect(() =>
      redeemMortgage({
        game,
        players: players([2_000_000, 500]),
        playerId: 'player-1',
        mortgage: { ...mortgage, gameId: 'other' },
      }),
    ).toThrow(MortgageNotFoundError);
  });
});
