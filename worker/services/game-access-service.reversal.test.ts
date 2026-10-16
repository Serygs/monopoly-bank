import { describe, expect, it } from 'vitest';
import { REVERSAL_WINDOW_MS, transactionTimeMs } from '../../shared/domain/reversal.js';
import type { Transaction } from '../../shared/types/monopoly.js';
import type { GameAccessRepository } from '../repositories/game-access-repository.js';
import { ConflictError, ForbiddenError } from './errors.js';
import { GameAccessService } from './game-access-service.js';

const createdAt = '2026-01-01 10:00:00';
const created = transactionTimeMs(createdAt);

const payment: Transaction = {
  id: 'payment',
  gameId: 'game',
  type: 'PLAYER_TO_PLAYER',
  amount: 50,
  totalAmount: 50,
  comment: null,
  createdAt,
  participants: [
    { playerId: 'payer', balanceDelta: -50 },
    { playerId: 'payee', balanceDelta: 50 },
  ],
};

function accessFor(role: 'OWNER' | 'PLAYER', controlled: readonly string[]): GameAccessService {
  return new GameAccessService({
    getRole: async () => role,
    isPlayerControlledBy: async (_gameId: string, _userId: string, playerId: string) =>
      controlled.includes(playerId),
  } as unknown as GameAccessRepository);
}

describe('reversal authority', () => {
  it('lets the game owner reverse anything, however old', async () => {
    await expect(
      accessFor('OWNER', []).requireReversalAuthority(
        'game',
        'owner',
        payment,
        created + 30 * REVERSAL_WINDOW_MS,
      ),
    ).resolves.toBeUndefined();
  });

  it('lets the controller of the paying wallet reverse it within the window', async () => {
    await expect(
      accessFor('PLAYER', ['payer']).requireReversalAuthority(
        'game',
        'user',
        payment,
        created + REVERSAL_WINDOW_MS,
      ),
    ).resolves.toBeUndefined();
  });

  it('refuses the paying wallet once the window has closed, pointing to the owner', async () => {
    const error = await accessFor('PLAYER', ['payer'])
      .requireReversalAuthority('game', 'user', payment, created + REVERSAL_WINDOW_MS + 1)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConflictError);
    expect(error).toMatchObject({ code: 'REVERSAL_WINDOW_EXPIRED' });
  });

  it('refuses the recipient and any other player', async () => {
    await expect(
      accessFor('PLAYER', ['payee']).requireReversalAuthority('game', 'user', payment, created),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      accessFor('PLAYER', ['bystander']).requireReversalAuthority('game', 'user', payment, created),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('refuses a player for a record that has no single initiating wallet', async () => {
    await expect(
      accessFor('PLAYER', ['payer', 'payee']).requireReversalAuthority(
        'game',
        'user',
        { ...payment, type: 'BANKRUPTCY_TRANSFER' },
        created,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
