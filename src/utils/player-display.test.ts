import { describe, expect, it } from 'vitest';
import { playerNameWithGameId } from './player-display';

describe('playerNameWithGameId', () => {
  it('keeps a unique player name unchanged', () => {
    expect(playerNameWithGameId({ id: 'player-1', name: 'Alex' }, [{ id: 'player-1', name: 'Alex' }, { id: 'player-2', name: 'Oleh' }])).toBe('Alex');
  });

  it('adds a stable, distinct game identifier for duplicate names', () => {
    const players = [{ id: '4f3e0001-0000-4000-8000-00000000A1B2', name: 'Alex' }, { id: '4f3e0002-0000-4000-8000-00000000C3D4', name: 'Alex' }];
    expect(playerNameWithGameId(players[0], players)).toBe('Alex · #A1B2');
    expect(playerNameWithGameId(players[1], players)).toBe('Alex · #C3D4');
  });
});
