import { describe, expect, it } from 'vitest';
import type { Transaction } from '../../shared/types/monopoly';
import { selectRecentEventsForPlayer } from './recent-events';

function event(
  id: string,
  createdAt: string,
  playerIds: string[],
  initiator?: string,
): Transaction {
  return {
    id,
    gameId: 'g',
    type: 'PLAYER_TO_PLAYER',
    amount: 1,
    totalAmount: 1,
    comment: null,
    createdAt,
    initiatorPlayerId: initiator ?? null,
    participants: playerIds.map((playerId) => ({
      playerId,
      balanceDelta: 1,
    })),
  };
}

describe('selectRecentEventsForPlayer', () => {
  const events = [
    event('a', '2026-01-01T10:00:00Z', ['p1', 'p2']),
    event('b', '2026-01-01T11:00:00Z', ['p2', 'p3']),
    event('c', '2026-01-01T12:00:00Z', ['p1']),
    event('d', '2026-01-01T13:00:00Z', ['p3'], 'p1'),
    event('e', '2026-01-01T14:00:00Z', ['p1', 'p3']),
  ];

  it('keeps only events the player takes part in, newest first, limited to three', () => {
    expect(selectRecentEventsForPlayer(events, 'p1').map((item) => item.id)).toEqual([
      'e',
      'd',
      'c',
    ]);
  });

  it('never returns other players events', () => {
    expect(selectRecentEventsForPlayer(events, 'p2').map((item) => item.id)).toEqual(['b', 'a']);
  });

  it('honours the limit and an empty list', () => {
    expect(selectRecentEventsForPlayer(events, 'p1', 1)).toHaveLength(1);
    expect(selectRecentEventsForPlayer([], 'p1')).toEqual([]);
  });

  it('does not reorder the input', () => {
    const copy = [...events];
    selectRecentEventsForPlayer(events, 'p1');
    expect(events).toEqual(copy);
  });
});
