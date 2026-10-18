import { describe, expect, it } from 'vitest';
import type { PaymentRequest } from '../../../shared/contracts/api';
import type { Player, TransactionType } from '../../../shared/types/monopoly';
import type { TranslationKey } from '../../i18n/translations';
import { t, alice, bob, stored, allActions } from '../../test/game-page-fixtures';
import {
  actionDescription,
  actionLabel,
  advancedWalletActions,
  bankLoanWalletActions,
  controllerLabel,
  destinationFor,
  filterTransactionsForPlayer,
  loanWalletActions,
  primaryWalletActions,
  sourceFor,
  splitPaymentRequests,
  transactionInvolvesPlayer,
  transactionLabel,
  walletActionTone,
  type ActionType,
} from './game-page-helpers';

describe('wallet actions', () => {
  it('lists the actions of each group', () => {
    expect(primaryWalletActions).toEqual([
      'PLAYER_TO_PLAYER',
      'PLAYER_TO_BANK',
      'BANK_TO_PLAYER',
      'PASS_GO',
    ]);
    expect(advancedWalletActions).toEqual([
      'PLAYER_TO_ALL',
      'ALL_TO_PLAYER',
      'MORTGAGE',
      'MORTGAGE_REDEMPTION',
    ]);
    expect(loanWalletActions).toEqual(['LOAN_ISSUE', 'LOAN_REPAYMENT']);
    expect(bankLoanWalletActions).toEqual(['BANK_LOAN']);
  });

  it.each(allActions)('marks %s as income or expense', (action) => {
    const income: ActionType[] = [
      'BANK_TO_PLAYER',
      'ALL_TO_PLAYER',
      'PASS_GO',
      'MORTGAGE',
      'PROPERTY_SELL_BUILDING',
      'BANK_LOAN',
      'LOAN_ISSUE',
      'JACKPOT_PAYOUT',
    ];
    expect(walletActionTone(action)).toBe(income.includes(action) ? 'income' : 'expense');
  });
});

describe('payment requests for a viewer', () => {
  const request = (id: string, patch: Partial<PaymentRequest> = {}): PaymentRequest => ({
    id,
    kind: 'PAYMENT',
    gameId: 'g1',
    payerPlayerId: 'p1',
    recipientPlayerId: 'p2',
    creatorPlayerId: 'p2',
    approverPlayerId: 'p1',
    amount: 10,
    comment: null,
    state: 'PENDING',
    expiresAt: '',
    createdAt: '',
    resolvedAt: null,
    transactionId: null,
    ...patch,
  });

  it('keeps for the inbox only the requests a controlled wallet must answer', () => {
    const mine = request('r1');
    const theirs = request('r2', { approverPlayerId: 'p3' });
    expect(splitPaymentRequests([mine, theirs], ['p1']).incoming).toEqual([mine]);
    expect(splitPaymentRequests([mine, theirs], ['p1', 'p3']).incoming).toEqual([mine, theirs]);
    expect(splitPaymentRequests([mine, theirs], ['p9']).incoming).toEqual([]);
  });

  it('lists everything as incoming when no wallet is known, and no outgoing loans', () => {
    const loan = request('r3', { kind: 'LOAN' });
    const result = splitPaymentRequests([loan], []);
    expect(result.incoming).toEqual([loan]);
    expect(result.outgoingLoans).toEqual([]);
  });

  it('lists as outgoing only loan requests the viewer made to someone else', () => {
    const outgoing = request('r1', { kind: 'LOAN', creatorPlayerId: 'p1', approverPlayerId: 'p2' });
    const payment = request('r2', {
      kind: 'PAYMENT',
      creatorPlayerId: 'p1',
      approverPlayerId: 'p2',
    });
    const foreign = request('r3', { kind: 'LOAN', creatorPlayerId: 'p3', approverPlayerId: 'p2' });
    const ownBoth = request('r4', { kind: 'LOAN', creatorPlayerId: 'p1', approverPlayerId: 'p1' });
    expect(
      splitPaymentRequests([outgoing, payment, foreign, ownBoth], ['p1']).outgoingLoans,
    ).toEqual([outgoing]);
  });
});

describe('which transactions involve a player', () => {
  const toBank = stored('t1', 'PLAYER_TO_BANK', [{ playerId: 'p1', balanceDelta: -10 }]);
  const between = stored('t2', 'PLAYER_TO_PLAYER', [
    { playerId: 'p2', balanceDelta: -10 },
    { playerId: 'p3', balanceDelta: 10 },
  ]);
  const swap = stored('t3', 'PROPERTY_TRANSFER', [
    { playerId: 'p1', balanceDelta: 0 },
    { playerId: 'p2', balanceDelta: 0 },
  ]);

  it('counts every listed participant, whatever the size of the change', () => {
    expect(transactionInvolvesPlayer(toBank, 'p1')).toBe(true);
    expect(transactionInvolvesPlayer(toBank, 'p2')).toBe(false);
    expect(transactionInvolvesPlayer(swap, 'p1')).toBe(true);
    expect(transactionInvolvesPlayer(swap, 'p2')).toBe(true);
    expect(transactionInvolvesPlayer(swap, 'p3')).toBe(false);
  });

  it('does not count a player who is not listed as a participant, even as initiator', () => {
    expect(transactionInvolvesPlayer({ ...toBank, initiatorPlayerId: 'p9' }, 'p9')).toBe(false);
  });

  it('keeps the order and the matching transactions of one player, or all with no player', () => {
    const all = [toBank, between, swap];
    expect(filterTransactionsForPlayer(all, null)).toBe(all);
    expect(filterTransactionsForPlayer(all, 'p1')).toEqual([toBank, swap]);
    expect(filterTransactionsForPlayer(all, 'p2')).toEqual([between, swap]);
    expect(filterTransactionsForPlayer(all, 'p9')).toEqual([]);
    expect(filterTransactionsForPlayer([], 'p1')).toEqual([]);
  });
});

describe('controllerLabel', () => {
  it('names the primary wallet and any other wallet as local', () => {
    expect(controllerLabel('PRIMARY', t)).toBe(t('primaryWallet'));
    expect(controllerLabel('LOCAL', t)).toBe(t('localWallet'));
    expect(t('primaryWallet')).not.toBe(t('localWallet'));
  });
});

describe('labels', () => {
  const labelKeys: Record<ActionType, TranslationKey> = {
    PLAYER_TO_PLAYER: 'payPlayer',
    PLAYER_TO_BANK: 'payBank',
    BANK_TO_PLAYER: 'bankPayment',
    PLAYER_TO_ALL: 'payEveryone',
    ALL_TO_PLAYER: 'everyonePaysMe',
    PASS_GO: 'passGo',
    MORTGAGE: 'mortgageProperty',
    MORTGAGE_REDEMPTION: 'redeemMortgage',
    PROPERTY_PURCHASE: 'buyProperty',
    PROPERTY_TRANSFER: 'tradeAction',
    PROPERTY_BUILD: 'buildProperty',
    PROPERTY_SELL_BUILDING: 'sellBuilding',
    PAY_RENT: 'payRent',
    LOAN_ISSUE: 'loanBorrow',
    LOAN_REPAYMENT: 'loanRepay',
    BANK_LOAN: 'loanBorrowBank',
    TO_JACKPOT: 'payFreeParking',
    JACKPOT_PAYOUT: 'collectFreeParking',
  };
  const descriptionKeys: Record<ActionType, TranslationKey> = {
    PLAYER_TO_PLAYER: 'actionPayPlayer',
    PLAYER_TO_BANK: 'actionPayBank',
    BANK_TO_PLAYER: 'actionReceiveBank',
    PLAYER_TO_ALL: 'actionPayEveryone',
    ALL_TO_PLAYER: 'actionEveryonePays',
    PASS_GO: 'actionPassGo',
    MORTGAGE: 'actionMortgage',
    MORTGAGE_REDEMPTION: 'actionRedeemMortgage',
    PROPERTY_PURCHASE: 'actionBuyProperty',
    PROPERTY_TRANSFER: 'actionTrade',
    PROPERTY_BUILD: 'actionBuildProperty',
    PROPERTY_SELL_BUILDING: 'actionSellBuilding',
    PAY_RENT: 'actionPayRent',
    LOAN_ISSUE: 'actionLoanIssue',
    LOAN_REPAYMENT: 'actionLoanRepay',
    BANK_LOAN: 'actionBankLoan',
    TO_JACKPOT: 'actionToJackpot',
    JACKPOT_PAYOUT: 'actionJackpotPayout',
  };
  const transactionKeys: Record<TransactionType, TranslationKey> = {
    PLAYER_TO_PLAYER: 'playerPayment',
    PLAYER_TO_BANK: 'paidBank',
    BANK_TO_PLAYER: 'receivedFromBank',
    PLAYER_TO_ALL: 'paidEveryone',
    ALL_TO_PLAYER: 'everyonePaidPlayer',
    PAY_RENT: 'paidRent',
    PASS_GO: 'passedGo',
    BANKRUPTCY_TRANSFER: 'bankruptcyTransfer',
    REVERSAL: 'reversal',
    MORTGAGE: 'mortgageLabel',
    MORTGAGE_REDEMPTION: 'redemptionLabel',
    PROPERTY_PURCHASE: 'propertyPurchaseLabel',
    PROPERTY_TRANSFER: 'propertyTradeLabel',
    PROPERTY_BUILD: 'propertyBuildLabel',
    PROPERTY_SELL_BUILDING: 'propertySellBuildingLabel',
    LOAN_ISSUE: 'loanIssueLabel',
    LOAN_REPAYMENT: 'loanRepaymentLabel',
    TO_JACKPOT: 'paidFreeParking',
    JACKPOT_PAYOUT: 'collectedFreeParking',
    AUCTION_PAYMENT: 'auctionPaymentLabel',
  };

  it.each(allActions)('%s has its own button label', (action) => {
    expect(actionLabel(action, t)).toBe(t(labelKeys[action]));
    expect(actionLabel(action, t)).not.toBe('');
  });

  it('gives every action a different button label', () => {
    expect(new Set(allActions.map((action) => actionLabel(action, t))).size).toBe(
      allActions.length,
    );
  });

  it.each(allActions)('%s has its own review description with the player name', (action) => {
    const text = actionDescription(action, 'Zed', t);
    expect(text).toBe(t(descriptionKeys[action], { name: 'Zed' }));
    expect(text).not.toBe('');
  });

  it.each(Object.keys(transactionKeys) as TransactionType[])(
    '%s has its own ledger label',
    (type) => {
      expect(transactionLabel(type, t)).toBe(t(transactionKeys[type]));
      expect(transactionLabel(type, t)).not.toBe('');
    },
  );

  it('gives every transaction type a different ledger label', () => {
    const types = Object.keys(transactionKeys) as TransactionType[];
    expect(new Set(types.map((type) => transactionLabel(type, t))).size).toBe(types.length);
  });
});

describe('where the money comes from and goes to', () => {
  const sourceOf = (action: ActionType, target: Player | null = null) =>
    sourceFor(action, alice, t, target);
  const destinationOf = (action: ActionType, target: Player | null = null, bank = false) =>
    destinationFor(action, alice, target, t, bank);

  it.each([
    ['BANK_TO_PLAYER', t('bank')],
    ['PASS_GO', t('bank')],
    ['MORTGAGE', t('bank')],
    ['PROPERTY_SELL_BUILDING', t('bank')],
    ['BANK_LOAN', t('bank')],
    ['ALL_TO_PLAYER', t('allOtherPlayers')],
    ['JACKPOT_PAYOUT', t('freeParkingPot')],
    ['PLAYER_TO_PLAYER', 'Alice'],
    ['PLAYER_TO_BANK', 'Alice'],
    ['PLAYER_TO_ALL', 'Alice'],
    ['MORTGAGE_REDEMPTION', 'Alice'],
    ['PROPERTY_PURCHASE', 'Alice'],
    ['PROPERTY_BUILD', 'Alice'],
    ['PAY_RENT', 'Alice'],
    ['LOAN_REPAYMENT', 'Alice'],
    ['TO_JACKPOT', 'Alice'],
  ] as const)('takes the money for %s from %s', (action, expected) => {
    expect(sourceOf(action, bob)).toBe(expected);
  });

  it('takes a player loan from the chosen lender, or from a placeholder before one is chosen', () => {
    expect(sourceOf('LOAN_ISSUE', bob)).toBe('Bob');
    expect(sourceOf('LOAN_ISSUE')).toBe(t('selectedPlayer'));
  });

  it.each([
    ['PLAYER_TO_BANK', t('bank')],
    ['MORTGAGE_REDEMPTION', t('bank')],
    ['PROPERTY_PURCHASE', t('bank')],
    ['PROPERTY_BUILD', t('bank')],
    ['PLAYER_TO_ALL', t('allOtherPlayers')],
    ['TO_JACKPOT', t('freeParkingPot')],
    ['PLAYER_TO_PLAYER', 'Bob'],
    ['LOAN_REPAYMENT', 'Bob'],
    ['PAY_RENT', 'Bob'],
    ['BANK_TO_PLAYER', 'Alice'],
    ['ALL_TO_PLAYER', 'Alice'],
    ['PASS_GO', 'Alice'],
    ['MORTGAGE', 'Alice'],
    ['PROPERTY_SELL_BUILDING', 'Alice'],
    ['LOAN_ISSUE', 'Alice'],
    ['BANK_LOAN', 'Alice'],
    ['JACKPOT_PAYOUT', 'Alice'],
  ] as const)('sends the money for %s to %s', (action, expected) => {
    expect(destinationOf(action, bob)).toBe(expected);
  });

  it('sends a payment to a placeholder before a player is chosen', () => {
    for (const action of ['PLAYER_TO_PLAYER', 'LOAN_REPAYMENT', 'PAY_RENT'] as const)
      expect(destinationOf(action)).toBe(t('selectedPlayer'));
  });

  it('sends a repayment to the bank when the loan is the bank’s', () => {
    expect(destinationOf('LOAN_REPAYMENT', bob, true)).toBe(t('bank'));
    expect(destinationOf('LOAN_REPAYMENT', bob, false)).toBe('Bob');
    expect(destinationOf('PLAYER_TO_PLAYER', bob, true)).toBe('Bob');
  });
});
