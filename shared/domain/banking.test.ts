import { describe, expect, it } from 'vitest';

import {
  allToPlayer,
  bankToPlayer,
  declareBankruptcy,
  IncompleteEstateError,
  InsufficientFundsError,
  InvalidAmountError,
  passGo,
  playerToAll,
  playerToBank,
  playerToPlayer,
  type BankruptcyCommand,
  type BankruptcyResult,
} from './banking.js';
import type { BoardSpace, Game, GameProperty, Player } from '../types/monopoly.js';

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

const estateSpaces: BoardSpace[] = [
  { id: 'space-01', boardIndex: 1, kind: 'STREET', colorGroup: 'BROWN', translationKey: 'space-01', customName: null, price: 60, mortgageValue: 30, houseCost: 50, rents: [2, 10, 30, 90, 160, 250] },
  { id: 'space-03', boardIndex: 3, kind: 'STREET', colorGroup: 'BROWN', translationKey: 'space-03', customName: null, price: 60, mortgageValue: 30, houseCost: 50, rents: [4, 20, 60, 180, 320, 450] },
  { id: 'space-12', boardIndex: 12, kind: 'UTILITY', colorGroup: 'UTILITY', translationKey: 'space-12', customName: null, price: 150, mortgageValue: 75, houseCost: null, rents: [] },
];

function estate(): GameProperty[] {
  return [
    { boardSpaceId: 'space-01', ownerPlayerId: 'player-1', houses: 3, mortgaged: false },
    { boardSpaceId: 'space-12', ownerPlayerId: 'player-1', houses: 0, mortgaged: true },
    { boardSpaceId: 'space-03', ownerPlayerId: 'player-2', houses: 0, mortgaged: false },
  ];
}

describe('bankruptcy without a board', () => {
  it('hands the whole remaining balance to the creditor and settles no estate', () => {
    const result = declareBankruptcy({ game, players: createPlayers([400, 700]), playerId: 'player-1', creditorPlayerId: 'player-2' });

    expect(result.transaction).toMatchObject({ type: 'BANKRUPTCY_TRANSFER', amount: 400, totalAmount: 400 });
    expect(balances(result)).toEqual([0, 1100]);
    expect(result.propertyChanges).toEqual([]);
    expect(result.buildingBankDelta).toEqual({ houses: 0, hotels: 0 });
  });

  it('records the placeholder transaction for a player who is already at zero', () => {
    const result = declareBankruptcy({ game, players: createPlayers([0, 700]), playerId: 'player-1', creditorPlayerId: 'player-2' });

    expect(result.transaction).toEqual({
      gameId: game.id,
      type: 'BANKRUPTCY_TRANSFER',
      amount: 1,
      totalAmount: 1,
      comment: null,
      participants: [],
    });
    expect(result.affectedPlayers).toEqual([]);
    expect(result.propertyChanges).toEqual([]);
  });
});

describe('bankruptcy with an estate', () => {
  it('passes every deed to the creditor with its mortgage state and sells the buildings back', () => {
    const result = declareBankruptcy({
      game,
      players: createPlayers([400, 700]),
      playerId: 'player-1',
      creditorPlayerId: 'player-2',
      spaces: estateSpaces,
      properties: estate(),
    });

    // 400 in cash plus 3 houses x floor(50 / 2) = 475 to the creditor.
    expect(result.transaction).toMatchObject({ type: 'BANKRUPTCY_TRANSFER', amount: 475, totalAmount: 475 });
    expect(balances(result)).toEqual([0, 1175]);
    expect(result.propertyChanges).toEqual([
      { boardSpaceId: 'space-01', ownerPlayerId: 'player-2', houses: 0, mortgaged: false },
      { boardSpaceId: 'space-12', ownerPlayerId: 'player-2', houses: 0, mortgaged: true },
    ]);
    expect(result.buildingBankDelta).toEqual({ houses: 3, hotels: 0 });
  });

  it('releases every deed to nobody when the bankruptcy is to the bank', () => {
    const result = declareBankruptcy({
      game,
      players: createPlayers([400, 700]),
      playerId: 'player-1',
      spaces: estateSpaces,
      properties: estate(),
    });

    expect(balances(result)).toEqual([0]);
    expect(result.propertyChanges).toEqual([
      { boardSpaceId: 'space-01', ownerPlayerId: null, houses: 0, mortgaged: false },
      { boardSpaceId: 'space-12', ownerPlayerId: null, houses: 0, mortgaged: true },
    ]);
    expect(result.buildingBankDelta).toEqual({ houses: 3, hotels: 0 });
  });

  it('returns a hotel rather than five houses', () => {
    const result = declareBankruptcy({
      game,
      players: createPlayers([0, 700]),
      playerId: 'player-1',
      creditorPlayerId: 'player-2',
      spaces: estateSpaces,
      properties: [{ boardSpaceId: 'space-01', ownerPlayerId: 'player-1', houses: 5, mortgaged: false }],
    });

    // No cash at all, so the bankrupt carries no participant row: only the 125 of
    // building proceeds moves, and the bank takes its hotel back.
    expect(result.transaction).toMatchObject({ type: 'BANKRUPTCY_TRANSFER', amount: 125, totalAmount: 125, participants: [{ playerId: 'player-2', balanceDelta: 125 }] });
    expect(balances(result)).toEqual([825]);
    expect(result.buildingBankDelta).toEqual({ houses: 0, hotels: 1 });
  });
});

describe('bankruptcy handed half an estate', () => {
  const halfEstate = (estateInput: Partial<BankruptcyCommand>): (() => BankruptcyResult) => () =>
    declareBankruptcy({ game, players: createPlayers([400, 700]), playerId: 'player-1', creditorPlayerId: 'player-2', ...estateInput });

  it.each([
    ['deeds without the spaces they stand on', { properties: estate() }],
    ['spaces without the deeds standing on them', { spaces: estateSpaces }],
  ])('refuses a bankruptcy given %s instead of silently leaving every deed with the bankrupt', (_label, estateInput) => {
    expect(halfEstate(estateInput)).toThrow(IncompleteEstateError);
  });

  it('reports the incomplete estate as a client error naming the missing field', () => {
    let thrown: unknown;
    try {
      halfEstate({ properties: estate() })();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(IncompleteEstateError);
    expect(thrown).toMatchObject({ code: 'INCOMPLETE_ESTATE', status: 400, details: { missing: ['spaces'] } });
  });
});
