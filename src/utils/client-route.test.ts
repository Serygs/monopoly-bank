import { describe, expect, it } from 'vitest';
import { currentRoute, routePath } from './client-route';

describe('client routes', () => {
  it('preserves a fragment invitation while an unauthenticated visitor signs in', () => {
    expect(currentRoute('/games/join', '', '#invite=secure-token')).toBe('/games/join#invite=secure-token');
  });

  it('matches a route by pathname while retaining its query in browser history', () => {
    expect(routePath('/games/join?invite=secure-token')).toBe('/games/join');
  });
});
