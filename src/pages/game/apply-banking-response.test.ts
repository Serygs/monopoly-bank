import { describe, expect, it } from 'vitest';
import type { GameDetails } from '../../../shared/contracts/api';
import { defaultGameRules, type GameProperty, type Player } from '../../../shared/types/monopoly';
import { applyBankingResponse } from './game-page-helpers';

const player = (id: string, balance: number): Player => ({
  id,
  gameId: 'g',
  name: id,
  color: '#126247',
  balance,
  createdAt: '',
});
const row = (tileId: string, houses: number): GameProperty => ({
  gameId: 'g',
  tileId,
  ownerPlayerId: 'a',
  mortgaged: false,
  houses,
});
const details: GameDetails = {
  game: {
    id: 'g',
    name: 'Game',
    startingBalance: 1500,
    passGoReward: 200,
    currency: 'USD',
    paymentMode: 'FAST',
    rules: defaultGameRules,
    settings: null,
    status: 'ACTIVE',
    createdAt: '',
    updatedAt: '',
  },
  players: [player('a', 100)],
  jackpot: 5,
  properties: [row('t1', 0), row('t2', 1)],
};

describe('applyBankingResponse', () => {
  it('replaces the players and keeps every field the response leaves out', () => {
    const next = applyBankingResponse(details, { players: [player('a', 40)] });
    expect(next.players[0]?.balance).toBe(40);
    expect(next.jackpot).toBe(5);
    expect(next.properties).toBe(details.properties);
    expect(next.mortgages).toBeUndefined();
  });

  it('takes the loans, mortgages, cooldowns and jackpot the response carries', () => {
    const next = applyBankingResponse(details, {
      players: [],
      mortgages: [],
      loans: [],
      bankLoanCooldowns: [],
      jackpot: 0,
    });
    expect(next).toMatchObject({ mortgages: [], loans: [], bankLoanCooldowns: [], jackpot: 0 });
  });

  it('merges the changed tiles into the registry by default', () => {
    const next = applyBankingResponse(details, { players: [], properties: [row('t2', 3)] });
    expect(next.properties).toEqual([row('t1', 0), row('t2', 3)]);
  });

  it('replaces the whole registry when asked', () => {
    const next = applyBankingResponse(
      details,
      { players: [], properties: [row('t2', 3)] },
      'replace',
    );
    expect(next.properties).toEqual([row('t2', 3)]);
  });
});
