import { describe, expect, it } from 'vitest';
import { playerNameWithGameId } from './player-display';

describe('playerNameWithGameId', () => {
  it('keeps a unique player name unchanged', () => {
    expect(
      playerNameWithGameId({ id: 'player-1', name: 'Alex' }, [
        { id: 'player-1', name: 'Alex' },
        { id: 'player-2', name: 'Oleh' },
      ]),
    ).toBe('Alex');
  });

  it('adds a stable, distinct game identifier for duplicate names', () => {
    const players = [
      { id: '4f3e0001-0000-4000-8000-00000000A1B2', name: 'Alex' },
      { id: '4f3e0002-0000-4000-8000-00000000C3D4', name: 'Alex' },
    ];
    expect(playerNameWithGameId(players[0], players)).toBe('Alex · #A1B2');
    expect(playerNameWithGameId(players[1], players)).toBe('Alex · #C3D4');
  });
});

describe('playerNameWithGameId suffixes', () => {
  const named = (id: string) => ({ id, name: 'Alex' });

  it('ignores dashes and letter case when it takes the suffix', () => {
    const players = [named('aaaa-bbbb-cccc-dddd'), named('1111-2222-3333-4444')];
    expect(playerNameWithGameId(players[0], players)).toBe('Alex · #DDDD');
    expect(playerNameWithGameId(players[1], players)).toBe('Alex · #4444');
  });

  it('uses a longer suffix when the last four characters collide', () => {
    const players = [named('11110000ABCD'), named('22220000ABCD')];
    expect(playerNameWithGameId(players[0], players)).toBe('Alex · #10000ABCD');
    expect(playerNameWithGameId(players[1], players)).toBe('Alex · #20000ABCD');
  });

  it('compares the suffix without regard to case', () => {
    const players = [named('00000000abcd'), named('11111111ABCD')];
    expect(playerNameWithGameId(players[0], players)).toBe('Alex · #0ABCD');
  });

  it('falls back to the whole identifier when no suffix tells two players apart', () => {
    const players = [named('abcd'), named('xabcd')];
    expect(playerNameWithGameId(players[0], players)).toBe('Alex · #ABCD');
    expect(playerNameWithGameId(players[1], players)).toBe('Alex · #XABCD');
  });

  it('does not mark a player whose name only another player shares in a different case', () => {
    const players = [
      { id: 'a', name: 'alex' },
      { id: 'b', name: 'Alex' },
    ];
    expect(playerNameWithGameId(players[0], players)).toBe('alex');
  });

  it('does not compare a player with themselves', () => {
    expect(playerNameWithGameId(named('x'), [named('x')])).toBe('Alex');
  });
});
