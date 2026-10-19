import { describe, expect, it, vi } from 'vitest';
import type { GameAccessRepository } from '../repositories/game-access-repository.js';
import { ConflictError, InvalidJoinCodeError } from './errors.js';
import { GameAccessService, resolveJoinAccess } from './game-access-service.js';

function service(overrides: Partial<GameAccessRepository> = {}) {
  const getGameAccessCredentials = vi.fn(async (code: string) =>
    code === 'ABCD'
      ? { gameId: 'game', passwordHash: null, passwordSalt: null, status: 'LOBBY' }
      : null,
  );
  const findInvitation = vi.fn(async () => ({ gameId: 'game', status: 'LOBBY' }));
  const access = new GameAccessService({
    getGameAccessCredentials,
    findInvitation,
    ...overrides,
  } as unknown as GameAccessRepository);
  return { access, getGameAccessCredentials, findInvitation };
}

describe('resolveJoinAccess', () => {
  it('resolves a code in its normal form without recording a failure', async () => {
    const { access, getGameAccessCredentials } = service();
    const recordFailure = vi.fn(async () => undefined);
    await expect(resolveJoinAccess(access, { joinCode: ' abcd ' }, recordFailure)).resolves.toEqual(
      {
        gameId: 'game',
        status: 'LOBBY',
      },
    );
    expect(getGameAccessCredentials).toHaveBeenCalledWith('ABCD');
    expect(recordFailure).not.toHaveBeenCalled();
  });

  it('records the code and refuses an unknown one', async () => {
    const { access } = service();
    const recordFailure = vi.fn(async () => undefined);
    await expect(
      resolveJoinAccess(access, { joinCode: 'ZZZZ' }, recordFailure),
    ).rejects.toBeInstanceOf(InvalidJoinCodeError);
    expect(recordFailure).toHaveBeenCalledExactlyOnceWith('ZZZZ');
  });

  it('records the code and refuses a code of a game that is no longer a lobby', async () => {
    const { access } = service({
      getGameAccessCredentials: async () => ({
        gameId: 'game',
        passwordHash: null,
        passwordSalt: null,
        status: 'ACTIVE',
      }),
    });
    const recordFailure = vi.fn(async () => undefined);
    const refused = resolveJoinAccess(access, { joinCode: 'ABCD' }, recordFailure);
    await expect(refused).rejects.toBeInstanceOf(ConflictError);
    await expect(refused).rejects.toMatchObject({ code: 'LOBBY_CLOSED' });
    expect(recordFailure).toHaveBeenCalledExactlyOnceWith('ABCD');
  });

  it('refuses a wrong password like an unknown code', async () => {
    const { access } = service({
      getGameAccessCredentials: async () => ({
        gameId: 'game',
        passwordHash: 'hash',
        passwordSalt: 'salt',
        status: 'LOBBY',
      }),
    });
    const recordFailure = vi.fn(async () => undefined);
    await expect(
      resolveJoinAccess(access, { joinCode: 'ABCD' }, recordFailure),
    ).rejects.toBeInstanceOf(InvalidJoinCodeError);
    expect(recordFailure).toHaveBeenCalledOnce();
  });

  it('never records a failure for an invitation', async () => {
    const recordFailure = vi.fn(async () => undefined);
    const missing = service({ findInvitation: async () => null });
    await expect(
      resolveJoinAccess(missing.access, { invitationToken: 'a'.repeat(32) }, recordFailure),
    ).rejects.toBeInstanceOf(InvalidJoinCodeError);
    const closed = service({
      findInvitation: async () => ({ gameId: 'game', status: 'FINISHED' }),
    });
    await expect(
      resolveJoinAccess(closed.access, { invitationToken: 'a'.repeat(32) }, recordFailure),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(recordFailure).not.toHaveBeenCalled();
  });
});
