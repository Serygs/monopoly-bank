import type { GameDetails } from '../contracts/api.js';
import {
  defaultGameRules,
  type Game,
  type GameProperty,
  type Player,
  type Transaction,
} from '../types/monopoly.js';

export function testUuid(suffix: number): string {
  return `00000000-0000-4000-8000-${suffix.toString(16).padStart(12, '0')}`;
}

export function buildGame(overrides: Partial<Game> = {}): Game {
  return {
    id: testUuid(1),
    name: 'Friday night',
    startingBalance: 1_500,
    passGoReward: 200,
    currency: 'USD',
    paymentMode: 'FAST',
    rules: defaultGameRules,
    settings: null,
    status: 'ACTIVE',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

export function buildPlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: testUuid(2),
    gameId: testUuid(1),
    name: 'Ada',
    color: '#000000',
    balance: 1_500,
    createdAt: '',
    ...overrides,
  };
}

export function buildTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: testUuid(4),
    gameId: testUuid(1),
    type: 'PLAYER_TO_BANK',
    amount: 100,
    totalAmount: 100,
    comment: null,
    createdAt: '',
    participants: [],
    ...overrides,
  };
}

export function buildGameProperty(overrides: Partial<GameProperty> = {}): GameProperty {
  return {
    gameId: testUuid(1),
    tileId: 'tile-1',
    ownerPlayerId: null,
    mortgaged: false,
    houses: 0,
    ...overrides,
  };
}

export function buildGameDetails(
  overrides: { game?: Partial<Game>; players?: Player[] } = {},
): GameDetails {
  const game = buildGame(overrides.game);
  return {
    game,
    players: overrides.players ?? [
      buildPlayer({ id: testUuid(2), gameId: game.id, name: 'Ada', color: '#e05263' }),
      buildPlayer({ id: testUuid(3), gameId: game.id, name: 'Lin', color: '#2f80ed' }),
    ],
  };
}
