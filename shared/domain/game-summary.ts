import type { Player, Transaction } from '../types/monopoly.js';

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
  let totalMoneyTransferred = 0;
  let playerToPlayerTotal = 0;
  let paidToBank = 0;
  let receivedFromBank = 0;
  let largestTransaction = 0;
  for (const transaction of transactions) {
    totalMoneyTransferred += transaction.totalAmount;
    largestTransaction = Math.max(largestTransaction, transaction.totalAmount);
    for (const participant of transaction.participants) {
      const metric = metrics.get(participant.playerId);
      if (metric !== undefined) {
        metric.transactionCount += 1;
        if (participant.balanceDelta < 0) metric.sent -= participant.balanceDelta;
        else metric.received += participant.balanceDelta;
      }
    }
    if (transaction.type === 'PLAYER_TO_BANK') paidToBank += transaction.totalAmount;
    if (transaction.type === 'BANK_TO_PLAYER' || transaction.type === 'PASS_GO')
      receivedFromBank += transaction.totalAmount;
    if (
      transaction.type === 'PLAYER_TO_PLAYER' ||
      transaction.type === 'PAY_RENT' ||
      transaction.type === 'BANKRUPTCY_TRANSFER'
    ) {
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
