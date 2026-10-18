import type { SetStateAction } from 'react';
import { describe, expect, it } from 'vitest';
import type { GameDetails } from '../../../shared/contracts/api';
import type { LiveServerEvent } from '../../../shared/contracts/live';
import type { Auction } from '../../../shared/types/monopoly';
import { game, alice, players, stored } from '../../test/game-page-fixtures';
import { applyLiveEvent } from './game-page-helpers';

describe('applyLiveEvent optional fields', () => {
  const cell = (initial: GameDetails | null) => {
    const holder = { value: initial };
    const set = (action: SetStateAction<GameDetails | null>) => {
      holder.value =
        typeof action === 'function'
          ? (action as (current: GameDetails | null) => GameDetails | null)(holder.value)
          : action;
    };
    return { holder, apply: (event: LiveServerEvent) => applyLiveEvent(event, set) };
  };
  const base: GameDetails = {
    game,
    players,
    jackpot: 50,
    mortgages: [],
    loans: [],
    bankLoanCooldowns: [],
  };
  const commit = (patch: Partial<Extract<LiveServerEvent, { type: 'GAME_COMMITTED' }>> = {}) =>
    ({
      type: 'GAME_COMMITTED',
      stateVersion: 2,
      transaction: stored('t1', 'PLAYER_TO_BANK', [{ playerId: 'p1', balanceDelta: -10 }]),
      players: [alice],
      ...patch,
    }) satisfies LiveServerEvent;
  const auction = (id: string, version: number, startedAt: string): Auction => ({
    id,
    gameId: 'g1',
    lotName: 'Lot',
    initiatorPlayerId: 'p1',
    state: 'ACTIVE',
    currentBid: 0,
    currentBidderId: null,
    version,
    startedAt,
    endsAt: startedAt,
    serverTime: startedAt,
    settledTransactionId: null,
  });

  it('keeps the loans, cooldowns, pot and registry when a commit carries none', () => {
    const { holder, apply } = cell(base);
    apply(commit());
    expect(holder.value).toEqual({ ...base, players: [alice] });
  });

  it('replaces each of them when the commit carries it, including empty and zero values', () => {
    const { holder, apply } = cell({ ...base, jackpot: 50, loans: [], mortgages: [] });
    apply(commit({ jackpot: 0, bankLoanCooldowns: [{ playerId: 'p1', roundsLeft: 1 }] }));
    expect(holder.value?.jackpot).toBe(0);
    expect(holder.value?.bankLoanCooldowns).toEqual([{ playerId: 'p1', roundsLeft: 1 }]);
    expect(holder.value?.loans).toEqual([]);
    apply(commit({ mortgages: [], loans: [] }));
    expect(holder.value?.mortgages).toEqual([]);
  });

  it('merges registry rows by tile and keeps the other rows', () => {
    const row = (tileId: string, ownerPlayerId: string | null) => ({
      gameId: 'g1',
      tileId,
      ownerPlayerId,
      mortgaged: false,
      houses: 0,
    });
    const { holder, apply } = cell({ ...base, properties: [row('a', null), row('b', null)] });
    apply(commit({ properties: [row('b', 'p1')] }));
    expect(holder.value?.properties).toEqual([row('a', null), row('b', 'p1')]);
  });

  it('keeps the newer of two auction updates and keeps the current auction when the update has none', () => {
    const { holder, apply } = cell({
      ...base,
      auction: auction('a1', 2, '2026-01-01T00:00:10.000Z'),
    });
    apply({
      type: 'AUCTION_UPDATED',
      stateVersion: 3,
      auction: auction('a1', 1, '2026-01-01T00:00:10.000Z'),
    });
    expect(holder.value?.auction?.version).toBe(2);
    apply({
      type: 'AUCTION_UPDATED',
      stateVersion: 4,
      auction: auction('a1', 3, '2026-01-01T00:00:10.000Z'),
    });
    expect(holder.value?.auction?.version).toBe(3);
    apply({ type: 'AUCTION_UPDATED', stateVersion: 5, auction: null });
    expect(holder.value?.auction?.version).toBe(3);
  });

  it('ignores an auction update before the game has loaded', () => {
    const { holder, apply } = cell(null);
    apply({
      type: 'AUCTION_UPDATED',
      stateVersion: 3,
      auction: auction('a1', 1, '2026-01-01T00:00:10.000Z'),
    });
    expect(holder.value).toBeNull();
  });

  it('keeps the controlled wallets of the server over the current ones in a finished game', () => {
    const { holder, apply } = cell({
      ...base,
      canManage: true,
      joinCode: 'JOIN',
      controlledPlayerIds: ['p1'],
    });
    apply({
      type: 'GAME_FINISHED',
      stateVersion: 6,
      details: { ...base, game: { ...game, status: 'FINISHED' }, controlledPlayerIds: ['p2'] },
    });
    expect(holder.value?.controlledPlayerIds).toEqual(['p2']);
    expect(holder.value?.canManage).toBe(true);
    expect(holder.value?.joinCode).toBe('JOIN');
  });

  it('takes the first snapshot as it is', () => {
    const { holder, apply } = cell(null);
    apply({
      type: 'GAME_SNAPSHOT',
      state: { stateVersion: 1, details: base, transactions: [] },
    });
    expect(holder.value).toBe(base);
  });
});
