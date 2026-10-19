import { describe, expect, it } from 'vitest';

import {
  allToPlayer,
  bankToPlayer,
  passGo,
  playerToAll,
  playerToBank,
  playerToPlayer,
  previewDeltas,
  type BankingOperationResult,
  type PreviewContext,
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

const players: Player[] = ['player-1', 'player-2', 'player-3'].map((id) => ({
  id,
  gameId: game.id,
  name: id,
  color: '#000000',
  balance: 1500,
  createdAt: '2026-01-01T00:00:00.000Z',
}));

const context: PreviewContext = {
  passGoReward: 200,
  redemptionAmount: 0,
  loans: [],
  interest: 0,
  jackpot: 0,
  tile: { amount: 0 },
};

function byPlayer(result: BankingOperationResult): Record<string, number> {
  return Object.fromEntries(
    result.transaction.participants.map(({ playerId, balanceDelta }) => [playerId, balanceDelta]),
  );
}

function previewed(deltas: ReturnType<typeof previewDeltas>): Record<string, number> {
  return Object.fromEntries(deltas.map(({ playerId, delta }) => [playerId, delta]));
}

describe('previewDeltas', () => {
  it('matches the operation for a player-to-player payment', () => {
    const operation = playerToPlayer({
      game,
      players,
      sourcePlayerId: 'player-1',
      destinationPlayerId: 'player-2',
      amount: 40,
    });
    const request = {
      type: 'PLAYER_TO_PLAYER',
      sourcePlayerId: 'player-1',
      destinationPlayerId: 'player-2',
      amount: 40,
    } as const;
    expect(previewed(previewDeltas(request, players, context))).toEqual(byPlayer(operation));
  });

  it('matches the operations for bank payments and Pass GO', () => {
    const cases = [
      [
        { type: 'PLAYER_TO_BANK', playerId: 'player-2', amount: 30 },
        playerToBank({ game, players, playerId: 'player-2', amount: 30 }),
      ],
      [
        { type: 'BANK_TO_PLAYER', playerId: 'player-3', amount: 70 },
        bankToPlayer({ game, players, playerId: 'player-3', amount: 70 }),
      ],
      [{ type: 'PASS_GO', playerId: 'player-1' }, passGo({ game, players, playerId: 'player-1' })],
    ] as const;
    for (const [request, operation] of cases)
      expect(previewed(previewDeltas(request, players, context))).toEqual(byPlayer(operation));
  });

  it('matches the operations that fan out to or in from every other player', () => {
    const out = playerToAll({ game, players, payerPlayerId: 'player-1', amountPerPlayer: 25 });
    const into = allToPlayer({ game, players, recipientPlayerId: 'player-1', amountPerPlayer: 25 });
    expect(
      previewed(
        previewDeltas(
          { type: 'PLAYER_TO_ALL', payerPlayerId: 'player-1', amountPerPlayer: 25 },
          players,
          context,
        ),
      ),
    ).toEqual(byPlayer(out));
    expect(
      previewed(
        previewDeltas(
          { type: 'ALL_TO_PLAYER', recipientPlayerId: 'player-1', amountPerPlayer: 25 },
          players,
          context,
        ),
      ),
    ).toEqual(byPlayer(into));
  });

  it('previews amounts the operations would refuse', () => {
    expect(
      previewDeltas({ type: 'PLAYER_TO_BANK', playerId: 'player-1', amount: 0 }, players, context),
    ).toEqual([{ playerId: 'player-1', delta: -0 }]);
  });
});
