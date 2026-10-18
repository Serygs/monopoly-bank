import { describe, expect, it, vi } from 'vitest';
import type { SecurityRateLimitRepository } from '../repositories/security-rate-limit-repository.js';
import { createApiRouter, type ApiRouterDependencies } from './api-router.js';
import { G, harness, read, request, withCommand } from '../test-support/api-router-harness.js';

function rateLimited() {
  const recordFailure = vi.fn(async () => undefined);
  const rateLimits: SecurityRateLimitRepository = {
    take: async () => true,
    recordFailure,
    isExceeded: async () => false,
    cleanup: async () => undefined,
  };
  const { m } = harness();
  const router = createApiRouter({
    games: m.games,
    banking: m.banking,
    auth: m.auth,
    access: m.access,
    profileStatistics: m.profileStatistics,
    rateLimits,
  } as unknown as ApiRouterDependencies);
  return { router, m, recordFailure };
}

describe.each(['/api/games/join', '/api/games/join/guest'])('join access on %s', (path) => {
  const guest = path.endsWith('/guest') ? { nickname: 'Ann', avatar: '🙂' } : {};
  const join = (body: object) => request('POST', path, { ...guest, ...body }, withCommand);

  it('records three failure buckets for an unknown code', async () => {
    const { router, m, recordFailure } = rateLimited();
    m.access.getJoinCredentials.mockResolvedValue(null);
    const response = await router(join({ joinCode: 'ABCD' }));
    expect(response.status).toBe(404);
    expect((await read(response)).error?.code).toBe('INVALID_JOIN_CODE');
    expect(recordFailure).toHaveBeenCalledTimes(3);
  });

  it('records three failure buckets for a lobby that is closed', async () => {
    const { router, m, recordFailure } = rateLimited();
    m.access.getJoinCredentials.mockResolvedValue({ gameId: G, status: 'ACTIVE' });
    const response = await router(join({ joinCode: 'ABCD' }));
    expect(response.status).toBe(409);
    expect((await read(response)).error?.code).toBe('LOBBY_CLOSED');
    expect(recordFailure).toHaveBeenCalledTimes(3);
  });

  it('records nothing for a bad invitation, a closed invitation lobby or a success', async () => {
    const { router, m, recordFailure } = rateLimited();
    const token = 'a'.repeat(32);
    m.access.invitation.mockResolvedValue(null);
    expect((await router(join({ invitationToken: token }))).status).toBe(404);
    m.access.invitation.mockResolvedValue({ gameId: G, status: 'FINISHED' });
    expect((await router(join({ invitationToken: token }))).status).toBe(409);
    await router(join({ joinCode: 'ABCD' }));
    expect(recordFailure).not.toHaveBeenCalled();
  });
});
