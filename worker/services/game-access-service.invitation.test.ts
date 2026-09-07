import { describe, expect, it } from 'vitest';
import type { GameAccessRepository } from '../repositories/game-access-repository.js';
import { ConflictError } from './errors.js';
import { GameAccessService } from './game-access-service.js';

describe('lobby invitation lifecycle', () => {
  it('creates an unlisted seven-day invitation without returning its stored token hash', async () => {
    let created: Parameters<NonNullable<GameAccessRepository['createInvitation']>>[0] | undefined;
    const service = new GameAccessService({ createInvitation: async (input) => { created = input; return true; } } as GameAccessRepository);
    const invitation = await service.createInvitation('game', 'owner');
    expect(invitation).toMatchObject({ shortCode: expect.stringMatching(/^[A-Z0-9]{8}$/), visibility: 'UNLISTED', invitationToken: expect.any(String) });
    expect(created).toMatchObject({ gameId: 'game', ownerUserId: 'owner', shortCode: invitation.shortCode, visibility: 'UNLISTED' });
    expect(created?.tokenHash).not.toBe(invitation.invitationToken);
    expect(new Date(invitation.expiresAt).getTime() - Date.now()).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
  });

  it('surfaces a closed lobby and rejects revocation when no invitation remains', async () => {
    const service = new GameAccessService({ createInvitation: async () => false, revokeInvitations: async () => false } as GameAccessRepository);
    await expect(service.createInvitation('game', 'owner')).rejects.toBeInstanceOf(ConflictError);
    await expect(service.revokeInvitations('game', 'owner')).rejects.toBeInstanceOf(ConflictError);
  });
});
