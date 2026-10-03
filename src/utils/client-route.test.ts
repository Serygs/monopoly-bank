import { describe, expect, it } from 'vitest';
import { currentRoute, routePath } from './client-route';

describe('client routes', () => {
  it('preserves a fragment invitation while an unauthenticated visitor signs in', () => {
    expect(currentRoute('/games/join', '', '#invite=secure-token')).toBe(
      '/games/join#invite=secure-token',
    );
  });

  it('matches a route by pathname while retaining its query in browser history', () => {
    expect(routePath('/games/join?invite=secure-token')).toBe('/games/join');
  });

  it('preserves game and invitation deep-link paths for the SPA shell', () => {
    expect(routePath('/games/00000000-0000-4000-8000-000000000001')).toBe(
      '/games/00000000-0000-4000-8000-000000000001',
    );
    expect(currentRoute('/games/join', '?code=TABLE42', '#invite=secure-token')).toBe(
      '/games/join?code=TABLE42#invite=secure-token',
    );
  });
});
