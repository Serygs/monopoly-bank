import { describe, expect, it } from 'vitest';
import { USER, harness, request, read } from '../test-support/api-router-harness.js';

describe('account routes', () => {
  it('registers with 201 and sets the session cookie', async () => {
    const { router, m } = harness();
    const response = await router(
      request('POST', '/api/auth/register', { nickname: 'Ann', avatar: '🙂', password: 'secret1' }),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get('set-cookie')).toBe('session=reg');
    expect(await read(response)).toEqual({ data: USER });
    expect(m.auth.register).toHaveBeenCalledWith({
      nickname: 'Ann',
      avatar: '🙂',
      password: 'secret1',
    });
  });

  it('logs in with the request id and sets the cookie', async () => {
    const { router, m } = harness();
    const response = await router(
      request(
        'POST',
        '/api/auth/login',
        { nickname: 'Ann', password: 'secret1' },
        { 'x-request-id': 'request-id-1' },
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBe('session=login');
    expect(response.headers.get('x-request-id')).toBe('request-id-1');
    expect(m.auth.login).toHaveBeenCalledWith(
      { nickname: 'Ann', password: 'secret1' },
      'request-id-1',
    );
  });

  it('generates a request id when the caller sends none or a malformed one', async () => {
    const { router } = harness();
    for (const headers of [
      {},
      { 'x-request-id': 'short' },
      { 'x-request-id': 'bad id with spaces!' },
    ]) {
      const response = await router(request('GET', '/api/profile', undefined, headers));
      const id = response.headers.get('x-request-id') ?? '';
      expect(id).toMatch(/^[0-9a-f-]{36}$/u);
    }
  });

  it('verifies an email token and returns what the service returns', async () => {
    const { router, m } = harness();
    m.auth.verifyEmail.mockResolvedValue({ verified: true });
    const response = await router(
      request('POST', '/api/auth/verify-email', { token: 'a'.repeat(32) }),
    );
    expect(await read(response)).toEqual({ data: { verified: true } });
    expect(m.auth.verifyEmail).toHaveBeenCalledWith('a'.repeat(32));
  });

  it('accepts a password-reset request with 202 and confirms a reset with null data', async () => {
    const { router, m } = harness();
    const asked = await router(request('POST', '/api/auth/password-reset', { email: 'A@b.co' }));
    expect(asked.status).toBe(202);
    expect(await read(asked)).toEqual({ data: { accepted: true } });
    expect(m.auth.requestPasswordReset).toHaveBeenCalledWith('a@b.co');
    const done = await router(
      request('POST', '/api/auth/password-reset/confirm', {
        token: 'a'.repeat(32),
        password: 'secret1',
      }),
    );
    expect(done.status).toBe(200);
    expect(await read(done)).toEqual({ data: null });
    expect(m.auth.resetPassword).toHaveBeenCalledWith('a'.repeat(32), 'secret1');
  });

  it('logs out and sends the cookie the service returned', async () => {
    const { router } = harness();
    const response = await router(request('POST', '/api/auth/logout'));
    expect(response.headers.get('set-cookie')).toBe('session=; Max-Age=0');
    expect(await read(response)).toEqual({ data: null });
  });

  it('revokes every session of the signed-in account', async () => {
    const { router, m } = harness();
    const response = await router(request('POST', '/api/auth/sessions/revoke-all'));
    expect(m.auth.revokeAll).toHaveBeenCalledWith(USER.id);
    expect(response.headers.get('set-cookie')).toBe('session=; Max-Age=0');
  });

  it('upgrades a guest and adds an email to a legacy account', async () => {
    const { router, m } = harness();
    const upgraded = await router(
      request('POST', '/api/auth/upgrade', { email: 'A@b.co', password: 'secret1' }),
    );
    expect(m.auth.upgradeGuest).toHaveBeenCalledWith(USER.id, 'a@b.co', 'secret1');
    expect(upgraded.headers.get('set-cookie')).toBe('session=up');
    await router(request('POST', '/api/auth/email', { email: 'A@b.co' }));
    expect(m.auth.addEmailToLegacyAccount).toHaveBeenCalledWith(USER.id, 'a@b.co');
    const resent = await router(request('POST', '/api/auth/verification-email'));
    expect(resent.status).toBe(202);
    expect(m.auth.resendVerification).toHaveBeenCalledWith(USER.id);
  });

  it('reads and updates the profile, and refuses another method', async () => {
    const { router, m } = harness();
    expect(await read(await router(request('GET', '/api/profile')))).toEqual({ data: USER });
    m.auth.update.mockResolvedValue({ ...USER, nickname: 'New' });
    const patched = await router(
      request('PATCH', '/api/profile', { nickname: 'New', avatar: '🙂' }),
    );
    expect(m.auth.update).toHaveBeenCalledWith(USER.id, 'New', '🙂');
    expect(await read(patched)).toEqual({ data: { ...USER, nickname: 'New' } });
    const other = await router(request('DELETE', '/api/profile'));
    expect(other.status).toBe(404);
  });

  it('records a PWA telemetry event and refuses an unknown one', async () => {
    const { router, m } = harness();
    for (const event of ['UPDATE_AVAILABLE', 'UPDATE_APPLIED', 'OFFLINE_SHELL']) {
      const response = await router(request('POST', '/api/telemetry/pwa', { event }));
      expect(response.status).toBe(202);
      expect(m.metrics.record).toHaveBeenLastCalledWith(
        'pwa',
        event.toLowerCase(),
        'success',
        0,
        202,
      );
    }
    const refused = await router(request('POST', '/api/telemetry/pwa', { event: 'OTHER' }));
    expect(refused.status).toBe(400);
    expect((await read(refused)).error?.code).toBe('VALIDATION_ERROR');
  });

  it('exports and deletes the account', async () => {
    const { router, m } = harness();
    m.auth.exportAccount.mockResolvedValue({ exported: true });
    expect(await read(await router(request('GET', '/api/account/export')))).toEqual({
      data: { exported: true },
    });
    const deleted = await router(request('DELETE', '/api/account'));
    expect(m.auth.deleteAccount).toHaveBeenCalledWith(USER.id);
    expect(deleted.headers.get('set-cookie')).toBe('session=; Max-Age=0');
    expect(await read(deleted)).toEqual({ data: null });
  });

  it('asks the session service for the actor and only renews the cookie for plain requests', async () => {
    const { router, m } = harness();
    await router(request('GET', '/api/profile'));
    expect(m.auth.current.mock.calls[0]?.[2]).toBeTypeOf('function');
    await router(request('GET', '/api/profile', undefined, { upgrade: 'WebSocket' }));
    expect(m.auth.current.mock.calls[1]?.[2]).toBeUndefined();
  });

  it('answers an unknown endpoint with 404', async () => {
    const { router } = harness();
    const response = await router(request('GET', '/api/unknown'));
    expect(response.status).toBe(404);
    expect(await read(response)).toMatchObject({
      error: { code: 'NOT_FOUND', message: 'Endpoint not found.' },
    });
  });
});
