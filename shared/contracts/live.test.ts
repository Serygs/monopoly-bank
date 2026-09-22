import { describe, expect, it } from 'vitest';
import { isLiveMutationCommand, isLiveServerEvent } from './live';

const commandId = '00000000-0000-4000-8000-000000000002';

describe('live server protocol', () => {
  it('accepts complete committed events and rejects partial wire payloads', () => {
    expect(isLiveServerEvent({ type: 'GAME_COMMITTED', stateVersion: 2, transaction: { id: 'transaction' }, players: [] })).toBe(true);
    expect(isLiveServerEvent({ type: 'GAME_COMMITTED', stateVersion: 2, transaction: { id: 'transaction' } })).toBe(false);
    expect(isLiveServerEvent({ type: 'PRESENCE_UPDATED', stateVersion: -1, connectedActors: 1 })).toBe(false);
  });

  it('recognises the property, trade, jail and dice commands and still rejects malformed envelopes', () => {
    expect(isLiveMutationCommand({ type: 'PROPERTY_OPERATION', commandId, operation: 'PURCHASE', request: { playerId: 'p', boardSpaceId: 's' } })).toBe(true);
    expect(isLiveMutationCommand({ type: 'PROPERTY_OPERATION', commandId, operation: 'RENT', request: { payerPlayerId: 'p', boardSpaceId: 's' } })).toBe(true);
    expect(isLiveMutationCommand({ type: 'PROPERTY_OPERATION', commandId, operation: 'AUCTION', request: {} })).toBe(false);
    expect(isLiveMutationCommand({ type: 'PROPERTY_OPERATION', commandId, operation: 'PURCHASE' })).toBe(false);
    expect(isLiveMutationCommand({ type: 'PROPOSE_TRADE', commandId, request: { proposerPlayerId: 'a', responderPlayerId: 'b' } })).toBe(true);
    expect(isLiveMutationCommand({ type: 'RESOLVE_TRADE', commandId, tradeId: 't', action: 'accept' })).toBe(true);
    expect(isLiveMutationCommand({ type: 'RESOLVE_TRADE', commandId, tradeId: 't', action: 'approve' })).toBe(false);
    expect(isLiveMutationCommand({ type: 'JAIL_BAIL', commandId, request: { playerId: 'p' } })).toBe(true);
    expect(isLiveMutationCommand({ type: 'DICE_ROLL', commandId, request: { playerId: 'p', first: 1, second: 2 } })).toBe(true);
    expect(isLiveMutationCommand({ type: 'DICE_ROLL', commandId: 'not-a-uuid', request: { playerId: 'p', first: 1, second: 2 } })).toBe(false);
    expect(isLiveMutationCommand({ type: 'CREATE_TRANSACTION', commandId, request: { type: 'PASS_GO', playerId: 'p' } })).toBe(true);
    expect(isLiveMutationCommand({ type: 'START_GAME', commandId })).toBe(true);
    expect(isLiveMutationCommand({ type: 'UNKNOWN', commandId })).toBe(false);
  });
});
