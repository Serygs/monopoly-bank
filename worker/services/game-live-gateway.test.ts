import { describe, expect, it } from 'vitest';
import type { UserProfile } from '../../shared/contracts/api.js';
import { DurableObjectGameLiveGateway } from './game-live-gateway.js';

const gameId = '00000000-0000-4000-8000-000000000001';
const actor = { id: 'user-7', nickname: 'Ann' } as UserProfile;

function gateway() {
  const received: Request[] = [];
  const names: string[] = [];
  const namespace = {
    idFromName: (name: string) => {
      names.push(name);
      return { name };
    },
    get: () => ({
      fetch: async (request: Request) => {
        received.push(request);
        return new Response('forwarded');
      },
    }),
  };
  return {
    live: new DurableObjectGameLiveGateway(namespace as never),
    received,
    names,
  };
}

describe('the Durable Object game gateway', () => {
  it('forwards a connection with the verified user, the game and the upgrade header', async () => {
    const { live, received, names } = gateway();
    const response = await live.connect(
      gameId,
      actor,
      new Request('https://bank.test/api/games/x/live', {
        headers: {
          upgrade: 'websocket',
          'x-request-id': 'req-1',
          'x-user-id': 'spoofed',
          'x-game-id': 'spoofed',
        },
      }),
    );
    expect(await response.text()).toBe('forwarded');
    expect(names).toEqual([gameId]);
    const [forwarded] = received;
    expect(new URL((forwarded as Request).url).pathname).toBe('/connect');
    expect(Object.fromEntries((forwarded as Request).headers)).toEqual({
      upgrade: 'websocket',
      'x-game-id': gameId,
      'x-user-id': 'user-7',
      'x-request-id': 'req-1',
    });
  });

  it('forwards an empty upgrade header, and a generated request id, when the client sent none', async () => {
    const { live, received } = gateway();
    await live.connect(gameId, actor, new Request('https://bank.test/api/games/x/live'));
    const headers = (received[0] as Request).headers;
    expect(headers.get('upgrade')).toBe('');
    expect(headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('forwards a command as a JSON POST from the verified user, never the client headers', async () => {
    const { live, received } = gateway();
    await live.mutate(gameId, actor, { type: 'START_GAME', commandId: 'c' } as never);
    const forwarded = received[0] as Request;
    expect(forwarded.method).toBe('POST');
    expect(new URL(forwarded.url).pathname).toBe('/mutation');
    expect(forwarded.headers.get('x-user-id')).toBe('user-7');
    expect(forwarded.headers.get('x-game-id')).toBe(gameId);
    expect(forwarded.headers.get('content-type')).toBe('application/json');
    expect(await forwarded.json()).toEqual({ type: 'START_GAME', commandId: 'c' });
  });

  it('reads the auction through the game object with a GET', async () => {
    const { live, received } = gateway();
    await live.readAuction(gameId, actor);
    const forwarded = received[0] as Request;
    expect(forwarded.method).toBe('GET');
    expect(new URL(forwarded.url).pathname).toBe('/auction');
    expect(forwarded.headers.get('x-user-id')).toBe('user-7');
    expect(forwarded.headers.get('x-game-id')).toBe(gameId);
  });
});
