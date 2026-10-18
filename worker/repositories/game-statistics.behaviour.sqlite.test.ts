// @vitest-environment node
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LedgerStatistics } from '../../shared/contracts/api.js';
import { defaultGameRules, type Game, type Player } from '../../shared/types/monopoly.js';
import { D1GameStatisticsRepository } from './game-statistics-repository.js';
import {
  d1,
  exec,
  migrated,
  rows,
  seedGame,
  seedPlayer,
  seedUser,
} from './test-support/sqlite-d1.test.js';

const baseGame: Game = {
  id: 'game',
  name: 'Stats',
  startingBalance: 1500,
  passGoReward: 200,
  currency: 'K',
  paymentMode: 'FAST',
  rules: defaultGameRules,
  settings: null,
  status: 'ACTIVE',
  createdAt: '',
  updatedAt: '',
  startedAt: '2026-01-01T00:00:00.000Z',
  finishedAt: '2026-01-01T00:01:00.000Z',
};

function playerOf(id: string, balance: number, status: 'ACTIVE' | 'BANKRUPT' = 'ACTIVE'): Player {
  return { id, gameId: 'game', name: id, color: '#000', balance, status, createdAt: '' };
}

describe('D1GameStatisticsRepository on SQLite', () => {
  let database: DatabaseSync;
  let statistics: D1GameStatisticsRepository;

  const tx = (
    id: string,
    type: string,
    amount: number,
    createdAt: string,
    deltas: Record<string, number>,
    extra: { reverses?: string; comment?: string; gameId?: string } = {},
  ) => {
    exec(
      database,
      'INSERT INTO transactions (id, game_id, type, amount, total_amount, comment, created_at, reverses_transaction_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id,
      extra.gameId ?? 'game',
      type,
      amount,
      amount,
      extra.comment ?? null,
      createdAt,
      extra.reverses ?? null,
    );
    for (const [playerId, delta] of Object.entries(deltas)) {
      exec(
        database,
        'INSERT INTO transaction_participants (transaction_id, game_id, player_id, balance_delta) VALUES (?, ?, ?, ?)',
        id,
        extra.gameId ?? 'game',
        playerId,
        delta,
      );
    }
  };
  const at = (second: number) => `2026-01-01 00:00:${String(second).padStart(2, '0')}`;

  beforeEach(async () => {
    database = await migrated();
    seedUser(database, 'owner');
    seedGame(database, 'game', { owner: 'owner' });
    seedGame(database, 'other', { owner: 'owner' });
    for (const id of ['a', 'b', 'c']) seedPlayer(database, id, 'game');
    seedPlayer(database, 'x', 'other');
    seedPlayer(database, 'y', 'other');
    statistics = new D1GameStatisticsRepository(d1(database));
  });

  describe('activity', () => {
    beforeEach(() => {
      tx('t1', 'PLAYER_TO_PLAYER', 10, at(1), { a: -10, b: 10 });
      tx('t2', 'PLAYER_TO_BANK', 10, at(2), { b: -10 });
      tx('t3', 'BANK_TO_PLAYER', 10, at(3), { c: 10 });
      tx('t4', 'PLAYER_TO_PLAYER', 10, at(4), { a: -10, c: 10 });
      tx('t5', 'PLAYER_TO_BANK', 10, at(5), { a: -10 });
      tx('o1', 'PLAYER_TO_BANK', 10, at(9), { x: -10 }, { gameId: 'other' });
    });

    it('returns everything newest first when the page is large enough', async () => {
      const page = await statistics.activity('game', 'ALL', [], null, 10);
      expect(page.transactions.map((item) => item.id)).toEqual(['t5', 't4', 't3', 't2', 't1']);
      expect(page.nextCursor).toBeNull();
      expect(page.paymentRequests).toEqual([]);
    });

    it('pages through the history with a cursor and ends with no cursor', async () => {
      const first = await statistics.activity('game', 'ALL', [], null, 2);
      expect(first.transactions.map((item) => item.id)).toEqual(['t5', 't4']);
      expect(first.nextCursor).toEqual({ createdAt: first.transactions[1].createdAt, id: 't4' });
      const second = await statistics.activity('game', 'ALL', [], first.nextCursor, 2);
      expect(second.transactions.map((item) => item.id)).toEqual(['t3', 't2']);
      expect(second.nextCursor).toEqual({ createdAt: second.transactions[1].createdAt, id: 't2' });
      const third = await statistics.activity('game', 'ALL', [], second.nextCursor, 2);
      expect(third.transactions.map((item) => item.id)).toEqual(['t1']);
      expect(third.nextCursor).toBeNull();
    });

    it('has no cursor when the page holds exactly the remaining rows', async () => {
      const page = await statistics.activity('game', 'ALL', [], null, 5);
      expect(page.transactions).toHaveLength(5);
      expect(page.nextCursor).toBeNull();
      const small = await statistics.activity('game', 'ALL', [], null, 4);
      expect(small.transactions).toHaveLength(4);
      expect(small.nextCursor).not.toBeNull();
    });

    it('orders rows created at the same instant by id and continues after the cursor id', async () => {
      tx('s1', 'PLAYER_TO_BANK', 5, at(30), { a: -5 });
      tx('s2', 'PLAYER_TO_BANK', 5, at(30), { a: -5 });
      tx('s3', 'PLAYER_TO_BANK', 5, at(30), { a: -5 });
      const first = await statistics.activity('game', 'ALL', [], null, 2);
      expect(first.transactions.map((item) => item.id)).toEqual(['s3', 's2']);
      const second = await statistics.activity('game', 'ALL', [], first.nextCursor, 2);
      expect(second.transactions.map((item) => item.id)).toEqual(['s1', 't5']);
    });

    it('limits MINE to transactions a given player took part in', async () => {
      const mine = await statistics.activity('game', 'MINE', ['b'], null, 10);
      expect(mine.transactions.map((item) => item.id)).toEqual(['t2', 't1']);
      const several = await statistics.activity('game', 'MINE', ['b', 'c'], null, 10);
      expect(several.transactions.map((item) => item.id)).toEqual(['t4', 't3', 't2', 't1']);
      const paged = await statistics.activity('game', 'MINE', ['a'], null, 2);
      expect(paged.transactions.map((item) => item.id)).toEqual(['t5', 't4']);
      const next = await statistics.activity('game', 'MINE', ['a'], paged.nextCursor, 2);
      expect(next.transactions.map((item) => item.id)).toEqual(['t1']);
    });

    it('returns an empty page for MINE without players, and ALL ignores the player filter', async () => {
      expect(await statistics.activity('game', 'MINE', [], null, 10)).toEqual({
        transactions: [],
        paymentRequests: [],
        nextCursor: null,
      });
      const all = await statistics.activity('game', 'ALL', ['b'], null, 10);
      expect(all.transactions).toHaveLength(5);
    });

    it('returns an empty page for a game without transactions', async () => {
      const page = await statistics.activity('missing', 'ALL', [], null, 10);
      expect(page).toEqual({ transactions: [], paymentRequests: [], nextCursor: null });
    });
  });

  describe('pending', () => {
    const request = (
      id: string,
      creator: string,
      approver: string,
      createdAt: string,
      state = 'PENDING',
      expires = '2999-01-01T00:00:00.000Z',
    ) => {
      const payer =
        creator === 'a' || approver === 'a' ? (creator === 'a' ? 'a' : approver) : creator;
      const recipient = payer === creator ? approver : creator;
      exec(
        database,
        "INSERT INTO payment_requests (id, game_id, payer_player_id, recipient_player_id, creator_player_id, approver_player_id, amount, comment, state, expires_at, created_at, resolved_at) VALUES (?, 'game', ?, ?, ?, ?, 25, 'rent', ?, ?, ?, ?)",
        id,
        payer,
        recipient,
        creator,
        approver,
        state,
        expires,
        createdAt,
        state === 'PENDING' ? null : '2026-01-02 00:00:00',
      );
    };

    it('returns nothing without players', async () => {
      request('r1', 'a', 'b', at(1));
      expect(await statistics.pending('game', [], null, 10)).toEqual({
        transactions: [],
        paymentRequests: [],
        nextCursor: null,
      });
    });

    it('lists pending requests the players created or must approve, newest first', async () => {
      request('r1', 'a', 'b', at(1));
      request('r2', 'b', 'a', at(2));
      request('r3', 'b', 'c', at(3));
      request('r4', 'a', 'c', at(4), 'ACCEPTED');
      const page = await statistics.pending('game', ['a'], null, 10);
      expect(page.paymentRequests.map((item) => item.id)).toEqual(['r2', 'r1']);
      expect(page.transactions).toEqual([]);
      expect(page.tradeRequests).toEqual([]);
      expect(page.nextCursor).toBeNull();
      const both = await statistics.pending('game', ['a', 'c'], null, 10);
      expect(both.paymentRequests.map((item) => item.id)).toEqual(['r3', 'r2', 'r1']);
    });

    it('maps every request field', async () => {
      request('r1', 'a', 'b', at(1));
      const [item] = (await statistics.pending('game', ['b'], null, 10)).paymentRequests;
      expect(item).toEqual({
        id: 'r1',
        kind: 'PAYMENT',
        gameId: 'game',
        payerPlayerId: 'a',
        recipientPlayerId: 'b',
        creatorPlayerId: 'a',
        approverPlayerId: 'b',
        amount: 25,
        comment: 'rent',
        state: 'PENDING',
        expiresAt: '2999-01-01T00:00:00.000Z',
        createdAt: at(1),
        resolvedAt: null,
        transactionId: null,
      });
    });

    it('expires stale requests of the game before listing and leaves other games alone', async () => {
      request('stale', 'a', 'b', at(1), 'PENDING', '2000-01-01T00:00:00.000Z');
      request('fresh', 'a', 'b', at(2));
      const page = await statistics.pending('game', ['a'], null, 10);
      expect(page.paymentRequests.map((item) => item.id)).toEqual(['fresh']);
      const stale = rows<{ state: string; resolved_at: string | null }>(
        database,
        "SELECT state, resolved_at FROM payment_requests WHERE id = 'stale'",
      )[0];
      expect(stale.state).toBe('EXPIRED');
      expect(stale.resolved_at).not.toBeNull();
    });

    it('pages with a cursor, repeating trades only on the first page', async () => {
      request('r1', 'a', 'b', at(1));
      request('r2', 'a', 'b', at(2));
      request('r3', 'a', 'b', at(3));
      const first = await statistics.pending('game', ['a'], null, 2);
      expect(first.paymentRequests.map((item) => item.id)).toEqual(['r3', 'r2']);
      expect(first.nextCursor).toEqual({ createdAt: at(2), id: 'r2' });
      expect('tradeRequests' in first).toBe(true);
      const second = await statistics.pending('game', ['a'], first.nextCursor, 2);
      expect(second.paymentRequests.map((item) => item.id)).toEqual(['r1']);
      expect(second.nextCursor).toBeNull();
      expect('tradeRequests' in second).toBe(false);
    });

    it('has no cursor when exactly a page is left, and continues past equal timestamps by id', async () => {
      request('r1', 'a', 'b', at(1));
      request('r2', 'a', 'b', at(1));
      request('r3', 'a', 'b', at(1));
      const exact = await statistics.pending('game', ['a'], null, 3);
      expect(exact.nextCursor).toBeNull();
      const first = await statistics.pending('game', ['a'], null, 2);
      expect(first.paymentRequests.map((item) => item.id)).toEqual(['r3', 'r2']);
      const second = await statistics.pending('game', ['a'], first.nextCursor, 2);
      expect(second.paymentRequests.map((item) => item.id)).toEqual(['r1']);
    });
  });

  describe('calculate', () => {
    beforeEach(() => {
      tx('t1', 'PLAYER_TO_PLAYER', 100, at(1), { a: -100, b: 100 });
      tx('t2', 'PLAYER_TO_BANK', 50, at(2), { a: -50 });
      tx('t3', 'BANK_TO_PLAYER', 70, at(3), { b: 70 });
      tx('t4', 'PASS_GO', 200, at(4), { a: 200 });
      tx('t5', 'PAY_RENT', 30, at(5), { b: -30, c: 30 });
      tx('t6', 'LOAN_ISSUE', 500, at(6), { b: 500, c: -500 });
      tx('t7', 'TO_JACKPOT', 20, at(7), { c: -20 });
      tx('t8', 'PLAYER_TO_PLAYER', 999, at(8), { a: -999, b: 999 });
      tx('r8', 'REVERSAL', 999, at(9), { a: 999, b: -999 }, { reverses: 't8' });
    });

    const players = [playerOf('a', 1000), playerOf('b', 2000), playerOf('c', 500)];
    const find = (summary: LedgerStatistics, id: string) =>
      summary.players.find((entry) => entry.player.id === id);

    it('totals the counted ledger by kind and ignores reversed pairs', async () => {
      const summary = await statistics.calculate(baseGame, players);
      expect(summary).toMatchObject({
        totalTransactions: 7,
        totalMoneyTransferred: 970,
        largestSinglePayment: 500,
        largestTransaction: 500,
        playerToPlayerTotal: 130,
        paidToBank: 50,
        receivedFromBank: 270,
        biggestPayerRecipient: null,
        durationMs: 60_000,
      });
    });

    it('computes per-player sent, received, counts and GO passes without loans', async () => {
      const summary = await statistics.calculate(baseGame, players);
      expect(summary.players.map((entry) => entry.player.id)).toEqual(['a', 'b', 'c']);
      expect(find(summary, 'a')).toMatchObject({
        totalPaid: 150,
        totalReceived: 200,
        transactionCount: 3,
        passGoCount: 1,
      });
      expect(find(summary, 'b')).toMatchObject({
        totalPaid: 30,
        totalReceived: 170,
        transactionCount: 4,
        passGoCount: 0,
      });
      expect(find(summary, 'c')).toMatchObject({
        totalPaid: 20,
        totalReceived: 30,
        transactionCount: 3,
        passGoCount: 0,
      });
    });

    it('ranks the cash leaderboard by balance and names biggest and least senders', async () => {
      const summary = await statistics.calculate(baseGame, players);
      expect(summary.cashLeaderboard.map((entry) => entry.player.id)).toEqual(['b', 'a', 'c']);
      expect(summary.cashLeaderboard[1]).toMatchObject({
        sent: 150,
        received: 200,
        passGoCount: 1,
        transactionCount: 3,
      });
      expect(summary.biggestSenderId).toBe('a');
      expect(summary.leastSenderId).toBe('c');
    });

    it('breaks equal balances and equal sent totals by player id', async () => {
      const empty = await statistics.calculate(
        baseGame,
        [playerOf('c', 100), playerOf('a', 100), playerOf('b', 100)].slice(0, 3),
      );
      const ordered = empty.cashLeaderboard.map((entry) => entry.player.id);
      expect(ordered).toEqual(['a', 'b', 'c']);
    });

    it('ignores bankrupt players for the richest and lowest active balance', async () => {
      const summary = await statistics.calculate(baseGame, [
        playerOf('a', 1000),
        playerOf('b', 2000, 'BANKRUPT'),
        playerOf('c', 500),
      ]);
      expect(summary.richestActivePlayer?.id).toBe('a');
      expect(summary.lowestActiveBalance).toBe(500);
      const lowestBankrupt = await statistics.calculate(baseGame, [
        playerOf('a', 1000),
        playerOf('b', 2000),
        playerOf('c', 500, 'BANKRUPT'),
      ]);
      expect(lowestBankrupt.richestActivePlayer?.id).toBe('b');
      expect(lowestBankrupt.lowestActiveBalance).toBe(1000);
    });

    it('reports no richest player when nobody is active', async () => {
      const summary = await statistics.calculate(baseGame, [playerOf('a', 1, 'BANKRUPT')]);
      expect(summary.richestActivePlayer).toBeNull();
      expect(summary.lowestActiveBalance).toBeNull();
    });

    it('has no senders and zero totals for an empty game', async () => {
      const summary = await statistics.calculate({ ...baseGame, id: 'other' }, []);
      expect(summary).toMatchObject({
        totalTransactions: 0,
        totalMoneyTransferred: 0,
        largestSinglePayment: 0,
        playerToPlayerTotal: 0,
        paidToBank: 0,
        receivedFromBank: 0,
        biggestSenderId: null,
        leastSenderId: null,
        richestActivePlayer: null,
        lowestActiveBalance: null,
        players: [],
        cashLeaderboard: [],
      });
    });

    it('lists players without activity with zero metrics', async () => {
      const summary = await statistics.calculate({ ...baseGame, id: 'other' }, [
        playerOf('x', 10),
        playerOf('y', 20),
      ]);
      expect(find(summary, 'x')).toMatchObject({
        totalPaid: 0,
        totalReceived: 0,
        transactionCount: 0,
        passGoCount: 0,
      });
      expect(summary.biggestSenderId).toBe('x');
      expect(summary.leastSenderId).toBe('y');
    });

    it('measures duration from start to finish, never negative, zero without a start', async () => {
      expect(
        (await statistics.calculate({ ...baseGame, startedAt: null }, players)).durationMs,
      ).toBe(0);
      expect(
        (
          await statistics.calculate(
            { ...baseGame, startedAt: undefined as unknown as null },
            players,
          )
        ).durationMs,
      ).toBe(0);
      expect(
        (
          await statistics.calculate(
            { ...baseGame, finishedAt: '2025-01-01T00:00:00.000Z' },
            players,
          )
        ).durationMs,
      ).toBe(0);
    });

    describe('running game clock', () => {
      afterEach(() => {
        vi.useRealTimers();
      });

      it('measures a running game up to now', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-01-01T00:05:00.000Z'));
        const summary = await statistics.calculate({ ...baseGame, finishedAt: null }, players);
        expect(summary.durationMs).toBe(300_000);
      });
    });

    it('derives awards and the balance series from the counted ledger', async () => {
      const summary = await statistics.calculate(baseGame, players);
      expect(summary.awards?.biggestOperation).toMatchObject({ type: 'PASS_GO', amount: 200 });
      expect(summary.balanceSeries?.players.map((entry) => entry.playerId)).toEqual([
        'a',
        'b',
        'c',
      ]);
      expect(summary.balanceSeries?.steps).toBe(7);
    });
  });

  describe('final snapshot', () => {
    it('is absent until saved, then returns winners and summary and keeps the first save', async () => {
      expect(await statistics.getFinalSnapshot('game')).toBeNull();
      const summary = await statistics.calculate(baseGame, [playerOf('a', 5)]);
      await statistics.saveFinalSnapshot('game', ['a', 'b'], summary);
      const stored = await statistics.getFinalSnapshot('game');
      expect(stored?.winnerPlayerIds).toEqual(['a', 'b']);
      expect(stored?.summary).toEqual(JSON.parse(JSON.stringify(summary)));
      await statistics.saveFinalSnapshot('game', ['c'], summary);
      expect((await statistics.getFinalSnapshot('game'))?.winnerPlayerIds).toEqual(['a', 'b']);
      expect(await statistics.getFinalSnapshot('other')).toBeNull();
    });
  });
});
