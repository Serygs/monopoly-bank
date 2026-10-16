export type AppTab = 'games' | 'add' | 'profile';

/** Which top-level tab a path belongs to; in-game paths have none (they own their navigation). */
export function appTabForPath(path: string): AppTab | null {
  if (path === '/profile') return 'profile';
  if (path === '/games/new' || path === '/games/join') return 'add';
  if (/^\/games\/[^/]+$/.test(path)) return null;
  return 'games';
}
