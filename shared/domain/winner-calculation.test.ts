import { describe, expect, it } from 'vitest';
import { calculateWinners } from './winner-calculation.js';
import type { Player } from '../types/monopoly.js';

const player = (id: string, status: Player['status'] = 'ACTIVE'): Player => ({ id, gameId: 'game', name: id, color: '#000', balance: 1, status, isInJail: false, consecutiveDoubles: 0, createdAt: '' });
describe('calculateWinners', () => {
  it('does not finish an ordinary active game', () => expect(calculateWinners([player('a'), player('b'), player('c')])).toEqual([]));
  it('awards all remaining active players after two bankruptcies', () => expect(calculateWinners([player('a'), player('b'), player('c'), player('d'), player('e', 'BANKRUPT'), player('f', 'BANKRUPT')]).map((item) => item.id)).toEqual(['a', 'b', 'c', 'd']));
  it('never counts bankrupt players as winners', () => expect(calculateWinners([player('a'), player('b'), player('c', 'BANKRUPT')]).map((item) => item.id)).toEqual(['a', 'b']));
});
