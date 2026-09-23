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

  it('accepts a committed event with the board fields and still accepts one without them', () => {
    const base = { type: 'GAME_COMMITTED', stateVersion: 3, transaction: { id: 'transaction' }, players: [] };
    expect(isLiveServerEvent({ ...base, properties: [{ boardSpaceId: 's', ownerPlayerId: 'p', houses: 0, mortgaged: false }], buildingBank: { housesAvailable: 31, hotelsAvailable: 12 }, jailChanges: [{ playerId: 'p', isInJail: false }] })).toBe(true);
    expect(isLiveServerEvent(base)).toBe(true);
    expect(isLiveServerEvent({ ...base, properties: 'all' })).toBe(false);
    expect(isLiveServerEvent({ ...base, jailChanges: {} })).toBe(false);
  });

  it('accepts TRADES_UPDATED and DICE_ROLLED only with a state version and their payload', () => {
    expect(isLiveServerEvent({ type: 'TRADES_UPDATED', stateVersion: 4 })).toBe(true);
    expect(isLiveServerEvent({ type: 'TRADES_UPDATED' })).toBe(false);
    expect(isLiveServerEvent({ type: 'DICE_ROLLED', stateVersion: 5, player: { id: 'p' }, thirdDouble: false })).toBe(true);
    expect(isLiveServerEvent({ type: 'DICE_ROLLED', player: { id: 'p' }, thirdDouble: false })).toBe(false);
    expect(isLiveServerEvent({ type: 'DICE_ROLLED', stateVersion: 5, thirdDouble: true })).toBe(false);
    expect(isLiveServerEvent({ type: 'DICE_ROLLED', stateVersion: 5, player: { id: 'p' } })).toBe(false);
  });

  it('accepts an auction only as a PROPERTY_OPERATION that names the winner and the price', () => {
    expect(isLiveMutationCommand({ type: 'PROPERTY_OPERATION', commandId, operation: 'AUCTION', request: { winnerPlayerId: 'p', boardSpaceId: 's', price: 90 } })).toBe(true);
    expect(isLiveMutationCommand({ type: 'PROPERTY_OPERATION', commandId, operation: 'AUCTION', request: { boardSpaceId: 's', price: 90 } })).toBe(false);
    expect(isLiveMutationCommand({ type: 'PROPERTY_OPERATION', commandId, operation: 'AUCTION', request: { winnerPlayerId: 'p', boardSpaceId: 's' } })).toBe(false);
  });
});
