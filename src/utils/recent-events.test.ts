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

describe('selectRecentEventsForPlayer and who counts as involved', () => {
  it('counts a player who started a trade without being a participant of its money', () => {
    const started = event('t', '2026-01-02T00:00:00Z', ['p3'], 'p1');
    expect(selectRecentEventsForPlayer([started], 'p1')).toEqual([started]);
    expect(selectRecentEventsForPlayer([started], 'p3')).toEqual([started]);
    expect(selectRecentEventsForPlayer([started], 'p2')).toEqual([]);
  });

  it('counts a participant with a zero change and ignores a missing initiator', () => {
    const zero = { ...event('z', '2026-01-02T00:00:00Z', ['p1']), initiatorPlayerId: undefined };
    zero.participants = [{ playerId: 'p1', balanceDelta: 0 }];
    expect(selectRecentEventsForPlayer([zero], 'p1')).toEqual([zero]);
  });

  it('orders by time with the newest first and keeps the first of equal times', () => {
    const first = event('first', '2026-01-02T00:00:00Z', ['p1']);
    const second = event('second', '2026-01-02T00:00:00Z', ['p1']);
    const older = event('older', '2026-01-01T00:00:00Z', ['p1']);
    expect(
      selectRecentEventsForPlayer([older, first, second], 'p1').map((item) => item.id),
    ).toEqual(['first', 'second', 'older']);
  });

  it('returns nothing for a limit of zero and everything for a large one', () => {
    const list = [
      event('a', '2026-01-01T00:00:00Z', ['p1']),
      event('b', '2026-01-02T00:00:00Z', ['p1']),
    ];
    expect(selectRecentEventsForPlayer(list, 'p1', 0)).toEqual([]);
    expect(selectRecentEventsForPlayer(list, 'p1', 99)).toHaveLength(2);
  });
});
