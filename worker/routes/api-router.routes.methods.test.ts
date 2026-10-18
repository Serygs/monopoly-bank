import { describe, expect, it } from 'vitest';
import { G, P1, R, T, harness, read, request } from '../test-support/api-router-harness.js';

describe('methods a route does not serve', () => {
  it.each([
    ['PUT', '/api/games'],
    ['PUT', '/api/profile'],
    ['GET', '/api/auth/register'],
    ['GET', '/api/auth/login'],
    ['GET', '/api/games/join/guest'],
    ['POST', '/api/games/deleted'],
    ['PUT', `/api/games/${G}`],
    ['GET', `/api/games/${G}/start`],
    ['GET', `/api/games/${G}/finish`],
    ['GET', `/api/games/${G}/restore`],
    ['POST', `/api/games/${G}/summary`],
    ['POST', `/api/games/${G}/activity`],
    ['GET', `/api/games/${G}/bankruptcy`],
    ['DELETE', `/api/games/${G}/transactions`],
    ['DELETE', `/api/games/${G}/payment-requests`],
    ['DELETE', `/api/games/${G}/trade-requests`],
    ['GET', `/api/games/${G}/payment-requests/${R}/accept`],
    ['GET', `/api/games/${G}/trade-requests/${T}/cancel`],
    ['POST', `/api/games/${G}/players/${P1}/transactions`],
    ['DELETE', `/api/games/${G}/players/${P1}/dice-rolls`],
    ['GET', `/api/games/${G}/auctions`],
    ['GET', `/api/games/${G}/auctions/${R}/bids`],
    ['POST', `/api/games/${G}/live`],
    ['GET', '/api/unknown'],
  ])('answers %s %s with 404 NOT_FOUND and calls no service', async (method, path) => {
    const { router, m } = harness({ live: true });
    const response = await router(request(method, path));
    expect(response.status).toBe(404);
    expect((await read(response)).error).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Endpoint not found.',
    });
    expect(m.live.mutate).not.toHaveBeenCalled();
    expect(m.banking.createTransaction).not.toHaveBeenCalled();
    expect(m.games.deleteGame).not.toHaveBeenCalled();
  });
});

describe('reserved game paths read as a game id for GET', () => {
  it('refuses GET /api/games/join as a malformed game id', async () => {
    const { router } = harness();
    const response = await router(request('GET', '/api/games/join'));
    expect(response.status).toBe(400);
    expect((await read(response)).error?.message).toBe('gameId must be a UUID.');
  });
});
