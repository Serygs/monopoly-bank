import type { Player, Transaction, TransactionType } from '../types/monopoly.js';

export interface FinalGameSummary {
  totalMoneyTransferred: number;
  playerToPlayerTotal: number;
  paidToBank: number;
  receivedFromBank: number;
  largestTransaction: number;
  players: Array<{ playerId: string; sent: number; received: number; transactionCount: number }>;
  biggestPayerRecipient: {
    payerId: string;
    recipientId: string;
    amount: number;
    transactionCount: number;
  } | null;
  biggestSenderId: string | null;
  leastSenderId: string | null;
}

/** Global volume counts each transfer once, never once per participant. */
const PAID_TO_BANK_TYPES: ReadonlySet<TransactionType> = new Set([
  'PLAYER_TO_BANK',
  'MORTGAGE_REDEMPTION',
  'PROPERTY_PURCHASE',
  'PROPERTY_BUILD',
  'AUCTION_PAYMENT',
]);

const RECEIVED_FROM_BANK_TYPES: ReadonlySet<TransactionType> = new Set([
  'BANK_TO_PLAYER',
  'PASS_GO',
  'PROPERTY_SELL_BUILDING',
  'MORTGAGE',
]);

const PAIRED_TYPES: ReadonlySet<TransactionType> = new Set([
  'PLAYER_TO_PLAYER',
  'PAY_RENT',
  'BANKRUPTCY_TRANSFER',
]);

export function calculateFinalGameSummary(
  players: readonly Player[],
  transactions: readonly Transaction[],
): FinalGameSummary {
  const metrics = new Map(
    players.map((player) => [
      player.id,
      { playerId: player.id, sent: 0, received: 0, transactionCount: 0 },
    ]),
  );
  const pairs = new Map<
    string,
    { payerId: string; recipientId: string; amount: number; transactionCount: number }
  >();
  const reversedIds = new Set(
    transactions.flatMap((transaction) =>
      transaction.reversesTransactionId == null ? [] : [transaction.reversesTransactionId],
    ),
  );
  let totalMoneyTransferred = 0;
  let playerToPlayerTotal = 0;
  let paidToBank = 0;
  let receivedFromBank = 0;
  let largestTransaction = 0;
  for (const transaction of transactions) {
    // A reversed transaction and its reversal cancel out; the game did not move that money.
    if (
      transaction.type === 'REVERSAL' ||
      transaction.reversedByTransactionId != null ||
      reversedIds.has(transaction.id)
    )
      continue;
    totalMoneyTransferred += transaction.totalAmount;
    largestTransaction = Math.max(largestTransaction, transaction.totalAmount);
    // Borrowed and repaid money is a debt, not spending or income, so loan transactions count
    // toward the totals and each player's transaction count but not toward sent/received.
    // TO_JACKPOT counts as money the player sent and JACKPOT_PAYOUT as money received; neither is
    // paid to / received from the bank, nor player-to-player (the pot is neither).
    const isLoan = transaction.type === 'LOAN_ISSUE' || transaction.type === 'LOAN_REPAYMENT';
    for (const participant of transaction.participants) {
      const metric = metrics.get(participant.playerId);
      if (metric !== undefined) {
        metric.transactionCount += 1;
        if (isLoan) continue;
        if (participant.balanceDelta < 0) metric.sent -= participant.balanceDelta;
        else metric.received += participant.balanceDelta;
      }
    }
    if (PAID_TO_BANK_TYPES.has(transaction.type)) paidToBank += transaction.totalAmount;
    if (RECEIVED_FROM_BANK_TYPES.has(transaction.type)) receivedFromBank += transaction.totalAmount;
    // The cash of a trade is player-to-player money; who paid whom is not worked out for it.
    if (transaction.type === 'PROPERTY_TRANSFER') playerToPlayerTotal += transaction.totalAmount;
    if (PAIRED_TYPES.has(transaction.type)) {
      playerToPlayerTotal += transaction.totalAmount;
      const payer = transaction.participants.find((item) => item.balanceDelta < 0);
      const recipient = transaction.participants.find((item) => item.balanceDelta > 0);
      if (payer !== undefined && recipient !== undefined) {
        const key = `${payer.playerId}:${recipient.playerId}`;
        const current = pairs.get(key) ?? {
          payerId: payer.playerId,
          recipientId: recipient.playerId,
          amount: 0,
          transactionCount: 0,
        };
        current.amount += recipient.balanceDelta;
        current.transactionCount += 1;
        pairs.set(key, current);
      }
    }
  }
  const ordered = [...metrics.values()].sort((left, right) =>
    left.playerId.localeCompare(right.playerId),
  );
  const bySent = [...ordered].sort(
    (left, right) => right.sent - left.sent || left.playerId.localeCompare(right.playerId),
  );
  const biggestPayerRecipient =
    [...pairs.values()].sort(
      (left, right) =>
        right.amount - left.amount ||
        left.payerId.localeCompare(right.payerId) ||
        left.recipientId.localeCompare(right.recipientId),
    )[0] ?? null;
  return {
    totalMoneyTransferred,
    playerToPlayerTotal,
    paidToBank,
    receivedFromBank,
    largestTransaction,
    players: ordered,
    biggestPayerRecipient,
    biggestSenderId: bySent[0]?.playerId ?? null,
    leastSenderId: [...bySent].reverse()[0]?.playerId ?? null,
  };
}
