import { describe, expect, it } from 'vitest';
import { isLiveServerEvent } from './live';

describe('live server protocol', () => {
  it('accepts complete committed events and rejects partial wire payloads', () => {
    expect(isLiveServerEvent({ type: 'GAME_COMMITTED', stateVersion: 2, transaction: { id: 'transaction' }, players: [] })).toBe(true);
    expect(isLiveServerEvent({ type: 'GAME_COMMITTED', stateVersion: 2, transaction: { id: 'transaction' } })).toBe(false);
    expect(isLiveServerEvent({ type: 'PRESENCE_UPDATED', stateVersion: -1, connectedActors: 1 })).toBe(false);
  });
});
