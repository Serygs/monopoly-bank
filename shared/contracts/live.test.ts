import { describe, expect, it } from 'vitest';
import { isLiveMutationCommand, isLiveServerEvent } from './live';

describe('live server protocol', () => {
  it('accepts complete committed events and rejects partial wire payloads', () => {
    expect(
      isLiveServerEvent({
        type: 'GAME_COMMITTED',
        stateVersion: 2,
        transaction: { id: 'transaction' },
        players: [],
      }),
    ).toBe(true);
    expect(
      isLiveServerEvent({
        type: 'GAME_COMMITTED',
        stateVersion: 2,
        transaction: { id: 'transaction' },
      }),
    ).toBe(false);
    expect(
      isLiveServerEvent({ type: 'PRESENCE_UPDATED', stateVersion: -1, connectedActors: 1 }),
    ).toBe(false);
  });
});

describe('auction protocol', () => {
  const commandId = '00000000-0000-4000-8000-000000000001';
  const bid = { bidderPlayerId: 'p', auctionId: 'a', expectedVersion: 2, step: 10 };

  it('accepts well-formed auction commands and rejects partial ones', () => {
    expect(
      isLiveMutationCommand({
        type: 'START_AUCTION',
        commandId,
        request: { initiatorPlayerId: 'p', lotName: 'Lot' },
      }),
    ).toBe(true);
    expect(isLiveMutationCommand({ type: 'PLACE_BID', commandId, request: bid })).toBe(true);
    expect(isLiveMutationCommand({ type: 'START_AUCTION', commandId })).toBe(false);
    expect(
      isLiveMutationCommand({ type: 'START_AUCTION', commandId, request: { lotName: 'Lot' } }),
    ).toBe(false);
    expect(
      isLiveMutationCommand({ type: 'PLACE_BID', commandId, request: { ...bid, step: '10' } }),
    ).toBe(false);
    expect(
      isLiveMutationCommand({
        type: 'PLACE_BID',
        commandId,
        request: { ...bid, expectedVersion: undefined },
      }),
    ).toBe(false);
  });

  it('accepts AUCTION_UPDATED with an auction or null only', () => {
    expect(isLiveServerEvent({ type: 'AUCTION_UPDATED', stateVersion: 3, auction: null })).toBe(
      true,
    );
    expect(
      isLiveServerEvent({ type: 'AUCTION_UPDATED', stateVersion: 3, auction: { id: 'a' } }),
    ).toBe(true);
    expect(isLiveServerEvent({ type: 'AUCTION_UPDATED', stateVersion: 3 })).toBe(false);
    expect(isLiveServerEvent({ type: 'AUCTION_UPDATED', auction: null })).toBe(false);
  });
});
