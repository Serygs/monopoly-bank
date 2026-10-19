import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testUuid } from '../shared/test-support/fixtures.js';
import {
  AUCTION,
  G,
  P1,
  P2,
  START,
  U,
  gameDetails,
  harness,
  post,
  sentTo,
  socket,
} from './test-support/game-session-harness.js';

type Setup = ReturnType<typeof harness>;

interface Step {
  body: Record<string, unknown>;
  types: string[];
}

interface Scenario {
  name: string;
  prepare(setup: Setup): void;
  steps: Step[];
}

const R = testUuid(90);
const paymentStored = { id: R, approverPlayerId: P2, creatorPlayerId: P1 };
const tradeStored = { id: R, proposerPlayerId: P1, counterpartyPlayerId: P2 };
const running = { id: AUCTION, state: 'ACTIVE', endsAt: new Date(START + 30_000).toISOString() };
const bid = { bidderPlayerId: P1, auctionId: AUCTION, expectedVersion: 1, step: 10 };
const tx = { id: 'tx-1', type: 'PLAYER_TO_BANK' };

const scenarios: Scenario[] = [
  {
    name: 'payment requests',
    prepare: ({ banking }) => {
      banking.getPaymentRequest?.mockResolvedValue(paymentStored);
      banking.createTransaction?.mockResolvedValue({ paymentRequests: [{ id: R }], players: [] });
      banking.acceptPaymentRequest?.mockResolvedValue({
        paymentRequest: paymentStored,
        transaction: tx,
        players: [],
      });
      const answered = { paymentRequest: paymentStored, players: [] };
      banking.declinePaymentRequest?.mockResolvedValue(answered);
      banking.cancelPaymentRequest?.mockResolvedValue(answered);
    },
    steps: [
      {
        body: {
          type: 'CREATE_TRANSACTION',
          request: { type: 'PLAYER_TO_BANK', playerId: P1, amount: 10 },
        },
        types: ['PAYMENT_REQUESTS_UPDATED'],
      },
      {
        body: { type: 'ACCEPT_PAYMENT_REQUEST', paymentRequestId: R },
        types: ['GAME_COMMITTED', 'PAYMENT_REQUESTS_UPDATED'],
      },
      {
        body: { type: 'DECLINE_PAYMENT_REQUEST', paymentRequestId: R },
        types: ['PAYMENT_REQUESTS_UPDATED'],
      },
      {
        body: { type: 'CANCEL_PAYMENT_REQUEST', paymentRequestId: R },
        types: ['PAYMENT_REQUESTS_UPDATED'],
      },
    ],
  },
  {
    name: 'trade requests',
    prepare: ({ banking }) => {
      banking.getTradeRequest?.mockResolvedValue(tradeStored);
      banking.createTradeRequest?.mockResolvedValue({ tradeRequest: tradeStored });
      banking.acceptTradeRequest?.mockResolvedValue({
        tradeRequest: tradeStored,
        transaction: tx,
        players: [],
      });
      const answered = { tradeRequest: tradeStored, players: [] };
      banking.declineTradeRequest?.mockResolvedValue(answered);
      banking.cancelTradeRequest?.mockResolvedValue(answered);
    },
    steps: [
      {
        body: {
          type: 'CREATE_TRADE_REQUEST',
          request: {
            id: R,
            playerId: P1,
            counterpartyPlayerId: P2,
            giveTileIds: ['a'],
            takeTileIds: [],
          },
        },
        types: ['TRADE_REQUESTS_UPDATED'],
      },
      {
        body: { type: 'ACCEPT_TRADE_REQUEST', tradeRequestId: R },
        types: ['GAME_COMMITTED', 'TRADE_REQUESTS_UPDATED'],
      },
      {
        body: { type: 'DECLINE_TRADE_REQUEST', tradeRequestId: R },
        types: ['TRADE_REQUESTS_UPDATED'],
      },
      {
        body: { type: 'CANCEL_TRADE_REQUEST', tradeRequestId: R },
        types: ['TRADE_REQUESTS_UPDATED'],
      },
    ],
  },
  {
    name: 'auctions',
    prepare: ({ auctions }) => {
      auctions.startAuction?.mockResolvedValue({ auction: running });
      auctions.placeBid?.mockResolvedValue({ auction: { ...running, version: 2 } });
    },
    steps: [
      {
        body: { type: 'START_AUCTION', request: { initiatorPlayerId: P1, lotName: 'Lot' } },
        types: ['AUCTION_UPDATED'],
      },
      { body: { type: 'PLACE_BID', request: bid }, types: ['AUCTION_UPDATED'] },
    ],
  },
  {
    name: 'lobby and game lifecycle',
    prepare: () => undefined,
    steps: [
      {
        body: {
          type: 'JOIN_LOBBY',
          playerId: P1,
          nickname: 'Ann',
          color: '#fff',
          startingBalance: 1500,
        },
        types: ['LOBBY_UPDATED'],
      },
      { body: { type: 'START_GAME' }, types: ['LOBBY_UPDATED'] },
      { body: { type: 'FINISH_GAME', winnerPlayerIds: [P1] }, types: ['GAME_FINISHED'] },
    ],
  },
];

describe('every connected socket receives the same broadcast', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(START);
  });
  afterEach(() => vi.useRealTimers());

  it.each(scenarios)(
    '$name reach two sockets identically with an incrementing version',
    async ({ prepare, steps }) => {
      const first = socket({ userId: 'a' });
      const second = socket({ userId: 'b' });
      const setup = harness({ sockets: [first, second] });
      prepare(setup);
      for (const [index, step] of steps.entries()) {
        const response = await setup.session.mutate(
          G,
          U,
          post({ ...step.body, commandId: testUuid(100 + index) }),
        );
        expect(response.status).toBeLessThan(300);
      }
      const received = sentTo(first);
      expect(sentTo(second)).toEqual(received);
      expect(received.map((event) => event.type)).toEqual(steps.flatMap((step) => step.types));
      const expectedVersions = steps.flatMap((step, index) => step.types.map(() => index + 1));
      expect(received.map((event) => event.stateVersion)).toEqual(expectedVersions);
    },
  );

  it('a finished game carries the final details to both sockets', async () => {
    const first = socket({ userId: 'a' });
    const second = socket({ userId: 'b' });
    const { session } = harness({ sockets: [first, second] });
    await session.mutate(G, U, post({ type: 'FINISH_GAME', winnerPlayerIds: [P1] }));
    const expected = [{ type: 'GAME_FINISHED', stateVersion: 1, details: gameDetails('FINISHED') }];
    expect(sentTo(first)).toEqual(expected);
    expect(sentTo(second)).toEqual(expected);
  });

  it('a bankruptcy reaches two sockets as a commit, then both pending-request updates, at one version', async () => {
    const first = socket({ userId: 'a' });
    const second = socket({ userId: 'b' });
    const { session, banking } = harness({ sockets: [first, second] });
    banking.declareBankruptcy?.mockResolvedValue({ transaction: tx, players: [] });
    await session.mutate(
      G,
      U,
      post({ type: 'DECLARE_BANKRUPTCY', request: { playerId: P1, creditor: { kind: 'BANK' } } }),
    );
    const received = sentTo(first);
    expect(sentTo(second)).toEqual(received);
    expect(received.map((event) => [event.type, event.stateVersion])).toEqual([
      ['GAME_COMMITTED', 1],
      ['PAYMENT_REQUESTS_UPDATED', 1],
      ['TRADE_REQUESTS_UPDATED', 1],
    ]);
  });
});
