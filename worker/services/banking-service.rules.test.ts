import { describe, expect, it, vi } from 'vitest';
import type { Game, Player } from '../../shared/types/monopoly.js';
import { defaultGameRules } from '../../shared/types/monopoly.js';
import { RuleDisabledError } from './errors.js';
import { DefaultBankingService } from './banking-service.js';

const playerId = '11111111-1111-4111-8111-111111111111';
const baseGame: Game = {
  id: 'game',
  name: 'Table',
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
const player: Player = {
  id: playerId,
  gameId: 'game',
  name: 'Ada',
  color: '#000',
  balance: 1000,
  status: 'ACTIVE',
  createdAt: '',
};

function service(game: Game) {
  const persist = vi.fn(async () => undefined);
  const banking = new DefaultBankingService({
    games: { getById: async () => game } as never,
    players: { listByGameId: async () => [player, { ...player, id: 'other' }] } as never,
    transactions: {
      getById: vi.fn(async (_gameId: string, id: string) =>
        id === 'transaction' && persist.mock.calls.length > 0 ? ({ id } as never) : null,
      ),
    } as never,
    operations: { persist } as never,
    paymentRequests: {} as never,
    createId: () => 'transaction',
  });
  return { banking, persist };
}

describe('Pass GO on an exact landing', () => {
  const request = { type: 'PASS_GO' as const, playerId, exactLanding: true };

  it('rejects the double reward with RULE_DISABLED and writes nothing when the rule is off', async () => {
    const { banking, persist } = service(baseGame);
    const error = await banking
      .createTransaction('game', request)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RuleDisabledError);
    expect(error).toMatchObject({
      code: 'RULE_DISABLED',
      details: { rule: 'doubleRewardOnExactGo' },
    });
    expect(persist).not.toHaveBeenCalled();
  });

  it('pays double when the game enabled the rule', async () => {
    const { banking, persist } = service({
      ...baseGame,
      rules: { ...defaultGameRules, doubleRewardOnExactGo: true },
    });
    const response = await banking.createTransaction('game', request);
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        transaction: expect.objectContaining({
          type: 'PASS_GO',
          amount: 400,
          totalAmount: 400,
          participants: [{ playerId, balanceDelta: 400 }],
        }),
        balanceChanges: [expect.objectContaining({ balanceBefore: 1000, balanceAfter: 1400 })],
      }),
    );
    expect(response.transaction.id).toBe('transaction');
  });

  it('still pays the normal reward without the flag, whatever the rule says', async () => {
    const { banking, persist } = service(baseGame);
    const response = await banking.createTransaction('game', { type: 'PASS_GO', playerId });
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        transaction: expect.objectContaining({ amount: 200 }),
        balanceChanges: [expect.objectContaining({ balanceBefore: 1000, balanceAfter: 1200 })],
      }),
    );
    expect(response.transaction.id).toBe('transaction');
  });
});
