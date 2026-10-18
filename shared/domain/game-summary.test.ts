import { describe, expect, it } from 'vitest';
import { calculateFinalGameSummary } from './game-summary.js';
import type { Player, Transaction } from '../types/monopoly.js';
const players: Player[] = ['a', 'b', 'c'].map((id) => ({
  id,
  gameId: 'g',
  name: id,
  color: '#000',
  balance: 0,
  createdAt: '',
}));
const transaction = (
  type: Transaction['type'],
  totalAmount: number,
  participants: Transaction['participants'],
): Transaction => ({
  id: `${type}-${totalAmount}`,
  gameId: 'g',
  type,
  amount: totalAmount,
  totalAmount,
  comment: null,
  createdAt: '',
  participants,
});
describe('calculateFinalGameSummary', () =>
  it('counts global volume once and identifies payer relationships deterministically', () => {
    const summary = calculateFinalGameSummary(players, [
      transaction('PLAYER_TO_PLAYER', 50, [
        { playerId: 'a', balanceDelta: -50 },
        { playerId: 'b', balanceDelta: 50 },
      ]),
      transaction('PLAYER_TO_BANK', 20, [{ playerId: 'a', balanceDelta: -20 }]),
      transaction('BANK_TO_PLAYER', 30, [{ playerId: 'c', balanceDelta: 30 }]),
    ]);
    expect(summary.totalMoneyTransferred).toBe(100);
    expect(summary.playerToPlayerTotal).toBe(50);
    expect(summary.paidToBank).toBe(20);
    expect(summary.receivedFromBank).toBe(30);
    expect(summary.biggestPayerRecipient).toMatchObject({
      payerId: 'a',
      recipientId: 'b',
      amount: 50,
    });
  }));

describe('the Free Parking pot in the final summary', () => {
  it('counts pot payments as sent and collections as received, never as bank or player money', () => {
    const summary = calculateFinalGameSummary(players, [
      transaction('TO_JACKPOT', 200, [{ playerId: 'a', balanceDelta: -200 }]),
      transaction('TO_JACKPOT', 75, [{ playerId: 'b', balanceDelta: -75 }]),
      transaction('JACKPOT_PAYOUT', 275, [{ playerId: 'c', balanceDelta: 275 }]),
    ]);
    expect(summary.totalMoneyTransferred).toBe(550);
    expect(summary.largestTransaction).toBe(275);
    expect(summary.playerToPlayerTotal).toBe(0);
    expect(summary.paidToBank).toBe(0);
    expect(summary.receivedFromBank).toBe(0);
    expect(summary.biggestPayerRecipient).toBeNull();
    const metric = (id: string) => summary.players.find((item) => item.playerId === id);
    expect(metric('a')).toMatchObject({ sent: 200, received: 0, transactionCount: 1 });
    expect(metric('b')).toMatchObject({ sent: 75, received: 0 });
    expect(metric('c')).toMatchObject({ sent: 0, received: 275 });
    expect(summary.biggestSenderId).toBe('a');
  });
});

describe('loans in the final summary', () => {
  it('count toward the volume but are neither sent nor received money', () => {
    const summary = calculateFinalGameSummary(players, [
      transaction('LOAN_ISSUE', 100, [
        { playerId: 'a', balanceDelta: -100 },
        { playerId: 'b', balanceDelta: 100 },
      ]),
      transaction('LOAN_REPAYMENT', 40, [
        { playerId: 'b', balanceDelta: -40 },
        { playerId: 'a', balanceDelta: 40 },
      ]),
    ]);
    expect(summary.totalMoneyTransferred).toBe(140);
    expect(summary.playerToPlayerTotal).toBe(0);
    expect(summary.paidToBank).toBe(0);
    expect(summary.receivedFromBank).toBe(0);
    expect(summary.biggestPayerRecipient).toBeNull();
    for (const metric of summary.players) {
      expect(metric.sent).toBe(0);
      expect(metric.received).toBe(0);
    }
    expect(summary.players.find((metric) => metric.playerId === 'a')?.transactionCount).toBe(2);
  });
});

describe('building in the final summary', () => {
  it('counts a build as paid to the bank and a sale as received from it', () => {
    const summary = calculateFinalGameSummary(players, [
      transaction('PROPERTY_BUILD', 500, [{ playerId: 'a', balanceDelta: -500 }]),
      transaction('PROPERTY_SELL_BUILDING', 250, [{ playerId: 'a', balanceDelta: 250 }]),
    ]);
    expect(summary.paidToBank).toBe(500);
    expect(summary.receivedFromBank).toBe(250);
    expect(summary.playerToPlayerTotal).toBe(0);
  });
});

const tx = (
  id: string,
  type: Transaction['type'],
  totalAmount: number,
  participants: Transaction['participants'],
  extra: Partial<Transaction> = {},
): Transaction => ({
  id,
  gameId: 'g',
  type,
  amount: totalAmount,
  totalAmount,
  comment: null,
  createdAt: '',
  participants,
  ...extra,
});
const metricOf = (summary: ReturnType<typeof calculateFinalGameSummary>, id: string) =>
  summary.players.find((item) => item.playerId === id);

describe('reversed transactions in the final summary', () => {
  const payment = tx('t1', 'PLAYER_TO_PLAYER', 80, [
    { playerId: 'a', balanceDelta: -80 },
    { playerId: 'b', balanceDelta: 80 },
  ]);
  const reversal = tx(
    'r1',
    'REVERSAL',
    80,
    [
      { playerId: 'a', balanceDelta: 80 },
      { playerId: 'b', balanceDelta: -80 },
    ],
    { reversesTransactionId: 't1' },
  );
  const untouched = tx('t2', 'PLAYER_TO_BANK', 25, [{ playerId: 'c', balanceDelta: -25 }]);

  const expectOnlyUntouchedCounted = (summary: ReturnType<typeof calculateFinalGameSummary>) => {
    expect(summary.totalMoneyTransferred).toBe(25);
    expect(summary.largestTransaction).toBe(25);
    expect(summary.playerToPlayerTotal).toBe(0);
    expect(summary.paidToBank).toBe(25);
    expect(summary.biggestPayerRecipient).toBeNull();
    expect(metricOf(summary, 'a')).toEqual({
      playerId: 'a',
      sent: 0,
      received: 0,
      transactionCount: 0,
    });
    expect(metricOf(summary, 'b')).toEqual({
      playerId: 'b',
      sent: 0,
      received: 0,
      transactionCount: 0,
    });
    expect(metricOf(summary, 'c')).toEqual({
      playerId: 'c',
      sent: 25,
      received: 0,
      transactionCount: 1,
    });
  };

  it('skips a payment and its reversal when only the reversal links back to it', () => {
    expectOnlyUntouchedCounted(calculateFinalGameSummary(players, [payment, reversal, untouched]));
  });

  it('skips a payment flagged as reversed even when the reversal is not in the list', () => {
    expectOnlyUntouchedCounted(
      calculateFinalGameSummary(players, [
        { ...payment, reversedByTransactionId: 'r1' },
        untouched,
      ]),
    );
  });

  it('skips a reversal whose original is not in the list', () => {
    expectOnlyUntouchedCounted(calculateFinalGameSummary(players, [reversal, untouched]));
  });

  it('skips a transaction of type REVERSAL that carries no link at all', () => {
    expectOnlyUntouchedCounted(
      calculateFinalGameSummary(players, [
        tx('r2', 'REVERSAL', 999, [{ playerId: 'a', balanceDelta: 999 }]),
        untouched,
      ]),
    );
  });

  it('counts a transaction whose link fields are null or missing', () => {
    const summary = calculateFinalGameSummary(players, [
      { ...payment, reversesTransactionId: null, reversedByTransactionId: null },
      tx('t3', 'PLAYER_TO_BANK', 10, [{ playerId: 'a', balanceDelta: -10 }]),
    ]);
    expect(summary.totalMoneyTransferred).toBe(90);
    expect(summary.largestTransaction).toBe(80);
    expect(summary.playerToPlayerTotal).toBe(80);
    expect(metricOf(summary, 'a')).toMatchObject({ sent: 90, transactionCount: 2 });
  });

  it('keeps counting the transactions around a reversed pair', () => {
    const summary = calculateFinalGameSummary(players, [
      tx('t0', 'PLAYER_TO_PLAYER', 10, [
        { playerId: 'c', balanceDelta: -10 },
        { playerId: 'a', balanceDelta: 10 },
      ]),
      payment,
      reversal,
      tx('t9', 'PLAYER_TO_PLAYER', 15, [
        { playerId: 'c', balanceDelta: -15 },
        { playerId: 'a', balanceDelta: 15 },
      ]),
    ]);
    expect(summary.totalMoneyTransferred).toBe(25);
    expect(summary.playerToPlayerTotal).toBe(25);
    expect(summary.biggestPayerRecipient).toEqual({
      payerId: 'c',
      recipientId: 'a',
      amount: 25,
      transactionCount: 2,
    });
  });
});

describe('how each transaction type is classified in the final summary', () => {
  const single = (type: Transaction['type']) =>
    calculateFinalGameSummary(players, [
      tx('x', type, 40, [
        { playerId: 'a', balanceDelta: -40 },
        { playerId: 'b', balanceDelta: 40 },
      ]),
    ]);
  const classify = (summary: ReturnType<typeof calculateFinalGameSummary>) => ({
    paidToBank: summary.paidToBank,
    receivedFromBank: summary.receivedFromBank,
    playerToPlayerTotal: summary.playerToPlayerTotal,
    pair: summary.biggestPayerRecipient !== null,
  });
  const none = { paidToBank: 0, receivedFromBank: 0, playerToPlayerTotal: 0, pair: false };

  it.each([
    ['PLAYER_TO_BANK', { ...none, paidToBank: 40 }],
    ['MORTGAGE_REDEMPTION', { ...none, paidToBank: 40 }],
    ['PROPERTY_PURCHASE', { ...none, paidToBank: 40 }],
    ['PROPERTY_BUILD', { ...none, paidToBank: 40 }],
    ['AUCTION_PAYMENT', { ...none, paidToBank: 40 }],
    ['BANK_TO_PLAYER', { ...none, receivedFromBank: 40 }],
    ['PASS_GO', { ...none, receivedFromBank: 40 }],
    ['PROPERTY_SELL_BUILDING', { ...none, receivedFromBank: 40 }],
    ['MORTGAGE', { ...none, receivedFromBank: 40 }],
    ['PROPERTY_TRANSFER', { ...none, playerToPlayerTotal: 40 }],
    ['PLAYER_TO_PLAYER', { ...none, playerToPlayerTotal: 40, pair: true }],
    ['PAY_RENT', { ...none, playerToPlayerTotal: 40, pair: true }],
    ['BANKRUPTCY_TRANSFER', { ...none, playerToPlayerTotal: 40, pair: true }],
    ['LOAN_ISSUE', none],
    ['LOAN_REPAYMENT', none],
    ['TO_JACKPOT', none],
    ['JACKPOT_PAYOUT', none],
  ] as const)('%s', (type, expected) => {
    expect(classify(single(type))).toEqual(expected);
  });

  it('counts a trade as player-to-player money without naming a payer', () => {
    const summary = single('PROPERTY_TRANSFER');
    expect(summary.biggestPayerRecipient).toBeNull();
    expect(metricOf(summary, 'a')).toMatchObject({ sent: 40, transactionCount: 1 });
    expect(metricOf(summary, 'b')).toMatchObject({ received: 40, transactionCount: 1 });
  });
});

describe('per-player figures in the final summary', () => {
  it('adds up sent, received and transaction counts over several transactions', () => {
    const summary = calculateFinalGameSummary(players, [
      tx('1', 'PLAYER_TO_PLAYER', 30, [
        { playerId: 'a', balanceDelta: -30 },
        { playerId: 'b', balanceDelta: 30 },
      ]),
      tx('2', 'PLAYER_TO_PLAYER', 20, [
        { playerId: 'b', balanceDelta: -20 },
        { playerId: 'a', balanceDelta: 20 },
      ]),
      tx('3', 'BANK_TO_PLAYER', 5, [{ playerId: 'a', balanceDelta: 5 }]),
    ]);
    expect(metricOf(summary, 'a')).toEqual({
      playerId: 'a',
      sent: 30,
      received: 25,
      transactionCount: 3,
    });
    expect(metricOf(summary, 'b')).toEqual({
      playerId: 'b',
      sent: 20,
      received: 30,
      transactionCount: 2,
    });
    expect(metricOf(summary, 'c')).toEqual({
      playerId: 'c',
      sent: 0,
      received: 0,
      transactionCount: 0,
    });
  });

  it('ignores participants that are not players of the game', () => {
    const summary = calculateFinalGameSummary(players, [
      tx('1', 'PLAYER_TO_PLAYER', 30, [
        { playerId: 'ghost', balanceDelta: -30 },
        { playerId: 'b', balanceDelta: 30 },
      ]),
    ]);
    expect(summary.players.map((item) => item.playerId)).toEqual(['a', 'b', 'c']);
    expect(metricOf(summary, 'b')).toMatchObject({ received: 30, transactionCount: 1 });
    expect(summary.biggestPayerRecipient).toEqual({
      payerId: 'ghost',
      recipientId: 'b',
      amount: 30,
      transactionCount: 1,
    });
  });

  it('returns the players ordered by id whatever order they were given in', () => {
    const shuffled = [players[2], players[0], players[1]] as Player[];
    expect(calculateFinalGameSummary(shuffled, []).players.map((item) => item.playerId)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('names the biggest and the least sender, breaking ties by player id', () => {
    const summary = calculateFinalGameSummary(players, [
      tx('1', 'PLAYER_TO_BANK', 50, [{ playerId: 'c', balanceDelta: -50 }]),
      tx('2', 'PLAYER_TO_BANK', 50, [{ playerId: 'b', balanceDelta: -50 }]),
      tx('3', 'PLAYER_TO_BANK', 10, [{ playerId: 'a', balanceDelta: -10 }]),
    ]);
    expect(summary.biggestSenderId).toBe('b');
    expect(summary.leastSenderId).toBe('a');
  });

  it('breaks a three-way tie on nothing sent by player id', () => {
    const summary = calculateFinalGameSummary(players, []);
    expect(summary.biggestSenderId).toBe('a');
    expect(summary.leastSenderId).toBe('c');
    expect(summary.largestTransaction).toBe(0);
    expect(summary.totalMoneyTransferred).toBe(0);
    expect(summary.biggestPayerRecipient).toBeNull();
  });

  it('has no sender at all without players', () => {
    const summary = calculateFinalGameSummary([], []);
    expect(summary.players).toEqual([]);
    expect(summary.biggestSenderId).toBeNull();
    expect(summary.leastSenderId).toBeNull();
  });
});

describe('payer and recipient pairs in the final summary', () => {
  it('adds up the same pair over several transactions and keeps the direction', () => {
    const summary = calculateFinalGameSummary(players, [
      tx('1', 'PLAYER_TO_PLAYER', 30, [
        { playerId: 'a', balanceDelta: -30 },
        { playerId: 'b', balanceDelta: 30 },
      ]),
      tx('2', 'PAY_RENT', 45, [
        { playerId: 'a', balanceDelta: -45 },
        { playerId: 'b', balanceDelta: 45 },
      ]),
      tx('3', 'PLAYER_TO_PLAYER', 60, [
        { playerId: 'b', balanceDelta: -60 },
        { playerId: 'a', balanceDelta: 60 },
      ]),
    ]);
    expect(summary.biggestPayerRecipient).toEqual({
      payerId: 'a',
      recipientId: 'b',
      amount: 75,
      transactionCount: 2,
    });
  });

  it('picks the pair with the most money, not the most transactions', () => {
    const summary = calculateFinalGameSummary(players, [
      tx('1', 'PLAYER_TO_PLAYER', 5, [
        { playerId: 'a', balanceDelta: -5 },
        { playerId: 'b', balanceDelta: 5 },
      ]),
      tx('2', 'PLAYER_TO_PLAYER', 5, [
        { playerId: 'a', balanceDelta: -5 },
        { playerId: 'b', balanceDelta: 5 },
      ]),
      tx('3', 'PLAYER_TO_PLAYER', 100, [
        { playerId: 'c', balanceDelta: -100 },
        { playerId: 'a', balanceDelta: 100 },
      ]),
    ]);
    expect(summary.biggestPayerRecipient).toMatchObject({ payerId: 'c', recipientId: 'a' });
  });

  it('breaks an equal amount by payer id and then by recipient id', () => {
    const pay = (id: string, from: string, to: string) =>
      tx(id, 'PLAYER_TO_PLAYER', 10, [
        { playerId: from, balanceDelta: -10 },
        { playerId: to, balanceDelta: 10 },
      ]);
    const byPayer = calculateFinalGameSummary(players, [pay('1', 'c', 'a'), pay('2', 'b', 'a')]);
    expect(byPayer.biggestPayerRecipient).toMatchObject({ payerId: 'b', recipientId: 'a' });
    const byRecipient = calculateFinalGameSummary(players, [
      pay('1', 'a', 'c'),
      pay('2', 'a', 'b'),
    ]);
    expect(byRecipient.biggestPayerRecipient).toMatchObject({ payerId: 'a', recipientId: 'b' });
  });

  it('skips a transfer that has a payer but no recipient', () => {
    const summary = calculateFinalGameSummary(players, [
      tx('1', 'PLAYER_TO_PLAYER', 10, [{ playerId: 'a', balanceDelta: -10 }]),
    ]);
    expect(summary.playerToPlayerTotal).toBe(10);
    expect(summary.biggestPayerRecipient).toBeNull();
  });

  it('skips a transfer that has a recipient but no payer', () => {
    const summary = calculateFinalGameSummary(players, [
      tx('1', 'PLAYER_TO_PLAYER', 10, [{ playerId: 'b', balanceDelta: 10 }]),
    ]);
    expect(summary.biggestPayerRecipient).toBeNull();
  });

  it('does not take a participant with no change for the payer or the recipient', () => {
    const summary = calculateFinalGameSummary(players, [
      tx('1', 'PLAYER_TO_PLAYER', 50, [
        { playerId: 'c', balanceDelta: 0 },
        { playerId: 'a', balanceDelta: -50 },
        { playerId: 'b', balanceDelta: 50 },
      ]),
    ]);
    expect(summary.biggestPayerRecipient).toMatchObject({ payerId: 'a', recipientId: 'b' });
  });
});
