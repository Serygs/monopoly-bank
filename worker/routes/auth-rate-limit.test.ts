import { describe, expect, it, vi } from 'vitest';
import type { SecurityRateLimitRepository } from '../repositories/security-rate-limit-repository.js';
import { createApiRouter } from './api-router.js';

function fixture() {
  const counts = new Map<string, number>();
  const rateLimits: SecurityRateLimitRepository = {
    async take(bucket, limit) {
      const count = (counts.get(bucket) ?? 0) + 1;
      counts.set(bucket, count);
      return count <= limit;
    },
    async cleanup() {},
  };
  const login = vi.fn(async () => ({ profile: { id: 'user' }, cookie: 'session=value' }));
  const router = createApiRouter({
    games: {} as never,
    banking: {} as never,
    auth: { login } as never,
    access: {} as never,
    profileStatistics: {} as never,
    rateLimits,
  });
  return { router, login, counts };
}

function loginRequest(nickname: string, source = '192.0.2.1'): Request {
  return new Request('https://bank.example.test/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': source },
    body: JSON.stringify({ nickname, password: 'secure-password' }),
  });
}

describe('login rate limits at a shared table', () => {
  it('allows six players on the same Wi-Fi to each log in twice', async () => {
    const { router, login } = fixture();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      for (let player = 0; player < 6; player += 1)
        expect((await router(loginRequest(`Player ${player}`))).status).toBe(200);
    }
    expect(login).toHaveBeenCalledTimes(12);
  });

  it('blocks repeated attempts for one account without blocking another player', async () => {
    const { router, login, counts } = fixture();
    for (let attempt = 0; attempt < 10; attempt += 1)
      expect((await router(loginRequest('Bsenkiv'))).status).toBe(200);
    const blocked = await router(loginRequest('bsenkiv'));
    expect(blocked.status).toBe(429);
    await expect(blocked.json()).resolves.toMatchObject({ error: { code: 'RATE_LIMITED' } });
    expect((await router(loginRequest('Lilia'))).status).toBe(200);
    expect(login).toHaveBeenCalledTimes(11);
    expect([...counts.keys()].join(' ')).not.toMatch(/bsenkiv|192\.0\.2\.1|secure-password/i);
  });

  it('bounds source-wide work even when an attacker changes account names', async () => {
    const { router, login } = fixture();
    for (let attempt = 0; attempt < 120; attempt += 1)
      expect((await router(loginRequest(`Account ${attempt}`))).status).toBe(200);
    expect((await router(loginRequest('Another account'))).status).toBe(429);
    expect(login).toHaveBeenCalledTimes(120);
  });

  it('rejects malformed login input before credential lookup', async () => {
    const { router, login } = fixture();
    const response = await router(
      new Request('https://bank.example.test/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nickname: 'Ada', password: '' }),
      }),
    );
    expect(response.status).toBe(400);
    expect(login).not.toHaveBeenCalled();
  });
});
