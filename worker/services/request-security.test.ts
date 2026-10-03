import { describe, expect, it } from 'vitest';
import { ForbiddenError } from './errors.js';
import {
  requireSameOriginForMutation,
  requireSameOriginWebSocket,
  securityHeaders,
} from './request-security.js';

describe('request security boundary', () => {
  it('rejects cross-site state changes but permits same-origin and non-browser clients', () => {
    expect(() =>
      requireSameOriginForMutation(
        new Request('https://bank.example/api/games', {
          method: 'POST',
          headers: { origin: 'https://attacker.example' },
        }),
      ),
    ).toThrow(ForbiddenError);
    expect(() =>
      requireSameOriginForMutation(
        new Request('https://bank.example/api/games', {
          method: 'POST',
          headers: { origin: 'https://bank.example' },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      requireSameOriginForMutation(
        new Request('https://bank.example/api/games', { method: 'POST' }),
      ),
    ).not.toThrow();
  });

  it('rejects a cross-origin WebSocket handshake and applies browser isolation headers', () => {
    expect(() =>
      requireSameOriginWebSocket(
        new Request('https://bank.example/api/games/id/live', {
          headers: { origin: 'https://attacker.example' },
        }),
      ),
    ).toThrow(ForbiddenError);
    const headers = new Headers();
    securityHeaders(new Request('https://bank.example/api/profile'), headers);
    expect(headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(headers.get('strict-transport-security')).toContain('max-age=31536000');
    expect(headers.get('referrer-policy')).toBe('no-referrer');
  });
});
