import { describe, expect, it } from 'vitest';
import {
  G,
  P1,
  P2,
  R,
  CMD,
  USER,
  details,
  harness,
  request,
  read,
  withCommand,
} from '../test-support/api-router-harness.js';

describe('live connection and summary routes', () => {
  const live = (headers: Record<string, string> = {}) =>
    request('GET', `/api/games/${G}/live`, undefined, {
      upgrade: 'websocket',
      origin: 'https://bank.example.test',
      ...headers,
    });

  it('forwards a member’s upgrade to the live game', async () => {
    const { router, m } = harness({ live: true });
    const response = await router(live());
    expect(await read(response)).toEqual({ data: { live: 'connected' } });
    expect(m.live.connect).toHaveBeenCalledWith(G, USER, expect.any(Request));
  });

  it('refuses a finished game with 409, a missing gateway with 503 and a foreign origin with 403', async () => {
    const finished = harness({ live: true });
    finished.m.games.getGame.mockResolvedValue(details({ status: 'FINISHED' }));
    const done = await finished.router(live());
    expect(done.status).toBe(409);
    expect((await read(done)).error).toMatchObject({
      code: 'GAME_FINISHED',
      message: 'This game is finished.',
    });
    const none = await harness().router(live());
    expect(none.status).toBe(503);
    expect((await read(none)).error).toMatchObject({
      code: 'LIVE_UNAVAILABLE',
      message: 'Live games are not configured.',
    });
    const foreign = await harness({ live: true }).router(live({ origin: 'https://attacker.test' }));
    expect(foreign.status).toBe(403);
  });

  it('refuses the summary when statistics are not configured', async () => {
    const { router } = harness({ statistics: false });
    const response = await router(request('GET', `/api/games/${G}/summary`));
    expect(response.status).toBe(409);
    expect((await read(response)).error).toMatchObject({
      code: 'STATISTICS_UNAVAILABLE',
      message: 'Statistics are not configured.',
    });
  });

  it('calculates the summary of a running game and names no winners', async () => {
    const { router, m } = harness();
    m.statistics.calculate.mockResolvedValue({ totalMoneyTransferred: 5 });
    const response = await router(request('GET', `/api/games/${G}/summary`));
    expect(await read(response)).toEqual({
      data: { game: details().game, winners: [], totalMoneyTransferred: 5 },
    });
    expect(m.statistics.getFinalSnapshot).not.toHaveBeenCalled();
    expect(m.statistics.calculate).toHaveBeenCalledWith(details().game, details().players);
  });

  it('reads the stored snapshot of a finished game and names its winners', async () => {
    const { router, m } = harness();
    const finished = details({ status: 'FINISHED' });
    m.games.getGame.mockResolvedValue(finished);
    m.statistics.getFinalSnapshot.mockResolvedValue({
      summary: { totalMoneyTransferred: 9 },
      winnerPlayerIds: [P2, 'ghost'],
    });
    const response = await router(request('GET', `/api/games/${G}/summary`));
    expect(await read(response)).toEqual({
      data: { game: finished.game, winners: [finished.players[1]], totalMoneyTransferred: 9 },
    });
    expect(m.statistics.calculate).not.toHaveBeenCalled();
  });

  it('calculates the summary of a finished game that has no snapshot', async () => {
    const { router, m } = harness();
    m.games.getGame.mockResolvedValue(details({ status: 'FINISHED' }));
    m.statistics.getFinalSnapshot.mockResolvedValue(null);
    m.statistics.calculate.mockResolvedValue({ totalMoneyTransferred: 1 });
    expect(await read(await router(request('GET', `/api/games/${G}/summary`)))).toMatchObject({
      data: { winners: [], totalMoneyTransferred: 1 },
    });
  });
});

describe('finishing a game', () => {
  const finish = (winnerPlayerIds: string[]) =>
    request('POST', `/api/games/${G}/finish`, { winnerPlayerIds }, withCommand);

  it('refuses winners who do not belong to the game', async () => {
    const { router, m } = harness();
    const response = await router(finish(['00000000-0000-4000-8000-0000000000ff']));
    expect(response.status).toBe(400);
    expect((await read(response)).error?.message).toBe('winnerPlayerIds must belong to this game.');
    expect(m.games.finishGame).not.toHaveBeenCalled();
  });

  it('finishes through the live game', async () => {
    const { router, m } = harness({ live: true });
    await router(finish([P1]));
    expect(m.live.mutate).toHaveBeenCalledWith(G, USER, {
      type: 'FINISH_GAME',
      commandId: CMD,
      winnerPlayerIds: [P1],
    });
  });

  it('refuses to finish without statistics', async () => {
    const { router } = harness({ statistics: false });
    const response = await router(finish([P1]));
    expect(response.status).toBe(409);
    expect((await read(response)).error?.code).toBe('STATISTICS_UNAVAILABLE');
  });

  it('saves the snapshot, finishes the game and records who won for each linked account', async () => {
    const { router, m } = harness();
    m.statistics.calculate.mockResolvedValue({ totalMoneyTransferred: 3 });
    m.games.finishGame.mockResolvedValue(details({ status: 'FINISHED' }));
    m.access.linkedMembers.mockResolvedValue([
      { userId: 'u1', playerId: P1 },
      { userId: 'u2', playerId: P2 },
      { userId: 'u3', playerId: null },
    ]);
    const response = await router(finish([P1]));
    expect(await read(response)).toEqual({ data: details({ status: 'FINISHED' }) });
    expect(m.statistics.saveFinalSnapshot).toHaveBeenCalledWith(G, [P1], {
      totalMoneyTransferred: 3,
    });
    expect(m.profileStatistics.recordCompletedGame).toHaveBeenCalledWith(G, [
      { userId: 'u1', won: true },
      { userId: 'u2', won: false },
    ]);
  });
});

describe('activity feed', () => {
  const feed = (query: string) => request('GET', `/api/games/${G}/activity${query}`);
  const cursor = btoa(JSON.stringify({ createdAt: '2026-01-01T00:00:00.000Z', id: R }));

  it('lists the whole game by default with the maximum page size', async () => {
    const { router, m } = harness();
    m.statistics.activity.mockResolvedValue({ items: [] });
    const response = await router(feed(''));
    expect(await read(response)).toEqual({ data: { items: [] } });
    expect(m.statistics.activity).toHaveBeenCalledWith(G, 'ALL', [P1, P2], null, 100);
  });

  it('lists the viewer’s own wallets, a cursor and a smaller page', async () => {
    const { router, m } = harness();
    await router(feed(`?scope=MINE&limit=5&cursor=${encodeURIComponent(cursor)}`));
    expect(m.statistics.activity).toHaveBeenCalledWith(
      G,
      'MINE',
      [P1, P2],
      { createdAt: '2026-01-01T00:00:00.000Z', id: R },
      5,
    );
  });

  it('lists what is pending for the viewer through its own query', async () => {
    const { router, m } = harness();
    await router(feed('?scope=PENDING&limit=1'));
    expect(m.statistics.pending).toHaveBeenCalledWith(G, [P1, P2], null, 1);
    expect(m.statistics.activity).not.toHaveBeenCalled();
  });

  it.each([
    ['?scope=OTHER', 'scope must be ALL, MINE, or PENDING.'],
    ['?limit=0', 'limit must be an integer between 1 and 100.'],
    ['?limit=101', 'limit must be an integer between 1 and 100.'],
    ['?limit=1.5', 'limit must be an integer between 1 and 100.'],
    ['?limit=abc', 'limit must be an integer between 1 and 100.'],
    ['?cursor=%%%', 'cursor is invalid.'],
    [`?cursor=${btoa('not json')}`, 'cursor is invalid.'],
    [`?cursor=${btoa(JSON.stringify({ createdAt: 5, id: R }))}`, 'cursor is invalid.'],
    [`?cursor=${btoa(JSON.stringify({ createdAt: 'x', id: 'short' }))}`, 'cursor is invalid.'],
    [`?cursor=${btoa('null')}`, 'cursor is invalid.'],
  ])('refuses %s', async (query, message) => {
    const { router } = harness();
    const response = await router(feed(query));
    expect(response.status).toBe(400);
    expect((await read(response)).error?.message).toBe(message);
  });

  it('accepts the limits 1 and 100', async () => {
    const { router, m } = harness();
    await router(feed('?limit=1'));
    await router(feed('?limit=100'));
    expect(m.statistics.activity.mock.calls.map((call) => call[4])).toEqual([1, 100]);
  });

  it('refuses without statistics', async () => {
    const { router } = harness({ statistics: false });
    expect((await router(feed(''))).status).toBe(409);
  });
});
