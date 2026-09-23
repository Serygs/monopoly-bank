import { afterEach, describe, expect, it, vi } from 'vitest';
import { monopolyBankApi } from './monopoly-bank-api.js';

describe('MonopolyBankApi transaction commands', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reuses a caller-provided command ID so a retry stays idempotent', async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init ?? {});
      return new Response(JSON.stringify({ data: { transaction: {}, players: [] } }), {
        headers: { 'content-type': 'application/json' },
      });
    });
    const request = {
      type: 'PLAYER_TO_BANK' as const,
      playerId: '00000000-0000-4000-8000-000000000001',
      amount: 100,
    };

    await monopolyBankApi.createTransaction(
      '00000000-0000-4000-8000-000000000002',
      request,
      '00000000-0000-4000-8000-000000000003',
    );
    await monopolyBankApi.createTransaction(
      '00000000-0000-4000-8000-000000000002',
      request,
      '00000000-0000-4000-8000-000000000003',
    );

    expect(calls).toHaveLength(2);
    expect(new Headers(calls[0]?.headers).get('x-command-id')).toBe(
      '00000000-0000-4000-8000-000000000003',
    );
    expect(new Headers(calls[1]?.headers).get('x-command-id')).toBe(
      '00000000-0000-4000-8000-000000000003',
    );
  });

  it.each([
    ['registered', () => monopolyBankApi.joinGame({ joinCode: 'TABLE42' })],
    [
      'guest',
      () =>
        monopolyBankApi.joinGameAsGuest({ joinCode: 'TABLE42', nickname: 'Guest', avatar: '🎩' }),
    ],
  ])(
    'adds a command ID when a %s player joins through the realtime mutation path',
    async (_actor, join) => {
      let requestInit: RequestInit | undefined;
      vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestInit = init;
        return new Response(JSON.stringify({ data: {} }), {
          headers: { 'content-type': 'application/json' },
        });
      });

      await join();

      expect(new Headers(requestInit?.headers).get('x-command-id')).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    },
  );
});
