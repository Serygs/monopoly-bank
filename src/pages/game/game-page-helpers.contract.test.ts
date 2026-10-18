import type { SetStateAction } from 'react';
import { describe, expect, it } from 'vitest';
import type { GameDetails, PaymentRequest } from '../../../shared/contracts/api';
import type { LiveServerEvent } from '../../../shared/contracts/live';
import {
  defaultGameRules,
  type Auction,
  type Game,
  type Loan,
  type Player,
  type Transaction,
  type TransactionType,
} from '../../../shared/types/monopoly';
import { MonopolyBankApiError } from '../../api/monopoly-bank-api';
import { translate, type Translate, type TranslationKey } from '../../i18n/translations';
import { formatMoney } from '../../utils/money';
import {
  actionDescription,
  actionLabel,
  advancedWalletActions,
  applyLiveEvent,
  bankLoanWalletActions,
  buildRequest,
  controllerLabel,
  destinationFor,
  filterTransactionsForPlayer,
  insufficientMessage,
  isPositiveInteger,
  loanWalletActions,
  lobbyNeedsMorePlayers,
  MIN_PLAYERS_TO_START,
  preflightFundsError,
  preflightShortfall,
  previewBalances,
  primaryWalletActions,
  sourceFor,
  splitPaymentRequests,
  transactionInvolvesPlayer,
  transactionLabel,
  walletActionTone,
  type ActionType,
} from './game-page-helpers';

const t: Translate = (key, values) => translate('en', key, values);

const game: Game = {
  id: 'g1',
  name: 'Friday night',
  startingBalance: 1_500,
  passGoReward: 200,
  currency: 'USD',
  paymentMode: 'FAST',
  rules: defaultGameRules,
  settings: null,
  status: 'ACTIVE',
  createdAt: '',
  updatedAt: '',
};

const player = (id: string, name: string, balance: number): Player => ({
  id,
  gameId: 'g1',
  name,
  color: '#000000',
  balance,
  createdAt: '',
});

const alice = player('p1', 'Alice', 1_000);
const bob = player('p2', 'Bob', 500);
const carol = player('p3', 'Carol', 100);
const players = [alice, bob, carol];

const stored = (
  id: string,
  type: TransactionType,
  participants: Transaction['participants'],
): Transaction => ({
  id,
  gameId: 'g1',
  type,
  amount: 10,
  totalAmount: 10,
  comment: null,
  createdAt: '',
  participants,
});

const allActions: ActionType[] = [
  'PLAYER_TO_PLAYER',
  'PLAYER_TO_BANK',
  'BANK_TO_PLAYER',
  'PLAYER_TO_ALL',
  'ALL_TO_PLAYER',
  'PASS_GO',
  'MORTGAGE',
  'MORTGAGE_REDEMPTION',
  'PROPERTY_PURCHASE',
  'PROPERTY_TRANSFER',
  'PROPERTY_BUILD',
  'PROPERTY_SELL_BUILDING',
  'PAY_RENT',
  'LOAN_ISSUE',
  'LOAN_REPAYMENT',
  'BANK_LOAN',
  'TO_JACKPOT',
  'JACKPOT_PAYOUT',
];

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

describe('buildRequest for every action', () => {
  it.each([
    [
      'PLAYER_TO_PLAYER',
      { type: 'PLAYER_TO_PLAYER', sourcePlayerId: 'p1', destinationPlayerId: 'p2', amount: 50 },
    ],
    ['PLAYER_TO_BANK', { type: 'PLAYER_TO_BANK', playerId: 'p1', amount: 50 }],
    ['BANK_TO_PLAYER', { type: 'BANK_TO_PLAYER', playerId: 'p1', amount: 50 }],
    ['TO_JACKPOT', { type: 'TO_JACKPOT', playerId: 'p1', amount: 50 }],
    ['PLAYER_TO_ALL', { type: 'PLAYER_TO_ALL', payerPlayerId: 'p1', amountPerPlayer: 50 }],
    ['ALL_TO_PLAYER', { type: 'ALL_TO_PLAYER', recipientPlayerId: 'p1', amountPerPlayer: 50 }],
  ] as const)('%s takes a trimmed comment and drops a blank one', (action, base) => {
    expect(buildRequest(action, 'p1', 'p2', 50, '  rent  ')).toEqual({ ...base, comment: 'rent' });
    const blank = buildRequest(action, 'p1', 'p2', 50, '   ');
    expect(blank).toEqual(base);
    expect(blank).not.toHaveProperty('comment');
    expect(buildRequest(action, 'p1', 'p2', 50, '')).toEqual(base);
  });

  it('needs a destination for a player payment and a lender for a loan', () => {
    expect(buildRequest('PLAYER_TO_PLAYER', 'p1', '', 50, '')).toBeNull();
    expect(buildRequest('LOAN_ISSUE', 'p1', '', 50, '')).toBeNull();
    expect(buildRequest('LOAN_ISSUE', 'p1', 'p2', 50, 'ignored')).toEqual({
      type: 'LOAN_ISSUE',
      borrowerPlayerId: 'p1',
      lenderPlayerId: 'p2',
      amount: 50,
    });
  });

  it('sends the reviewed pot for a collection, with no comment', () => {
    expect(buildRequest('JACKPOT_PAYOUT', 'p1', '', 300, 'note')).toEqual({
      type: 'JACKPOT_PAYOUT',
      playerId: 'p1',
      expectedAmount: 300,
    });
  });

  it('sends the exact-landing flag on Pass GO only when it is true', () => {
    expect(buildRequest('PASS_GO', 'p1', '', 0, '', { exactLanding: true })).toEqual({
      type: 'PASS_GO',
      playerId: 'p1',
      exactLanding: true,
    });
    for (const exactLanding of [false, undefined]) {
      const request = buildRequest('PASS_GO', 'p1', '', 0, '', { exactLanding });
      expect(request).toEqual({ type: 'PASS_GO', playerId: 'p1' });
      expect(request).not.toHaveProperty('exactLanding');
    }
    expect(buildRequest('PASS_GO', 'p1', '', 0, ' hi ')).toEqual({
      type: 'PASS_GO',
      playerId: 'p1',
      comment: 'hi',
    });
  });

  it('builds a mortgage by tile, by name, and refuses an empty tile', () => {
    expect(buildRequest('MORTGAGE', 'p1', '', 0, '', { tileId: 'zhitna' })).toEqual({
      type: 'MORTGAGE',
      playerId: 'p1',
      tileId: 'zhitna',
    });
    expect(buildRequest('MORTGAGE', 'p1', '', 0, '', { tileId: '' })).toBeNull();
    expect(
      buildRequest('MORTGAGE', 'p1', '', 70, 'ignored', { propertyName: 'Boardwalk' }),
    ).toEqual({
      type: 'MORTGAGE',
      playerId: 'p1',
      propertyName: 'Boardwalk',
      amount: 70,
    });
    expect(buildRequest('MORTGAGE', 'p1', '', 70, '')).toEqual({
      type: 'MORTGAGE',
      playerId: 'p1',
      propertyName: '',
      amount: 70,
    });
  });

  it('builds a redemption only for a chosen mortgage', () => {
    expect(buildRequest('MORTGAGE_REDEMPTION', 'p1', '', 0, '', { mortgageId: 'm1' })).toEqual({
      type: 'MORTGAGE_REDEMPTION',
      playerId: 'p1',
      mortgageId: 'm1',
    });
    expect(buildRequest('MORTGAGE_REDEMPTION', 'p1', '', 0, '')).toBeNull();
    expect(buildRequest('MORTGAGE_REDEMPTION', 'p1', '', 0, '', { mortgageId: '' })).toBeNull();
  });

  it('builds a purchase, a build and a sale for a tile, and refuses a missing or empty tile', () => {
    for (const action of [
      'PROPERTY_PURCHASE',
      'PROPERTY_BUILD',
      'PROPERTY_SELL_BUILDING',
    ] as const) {
      expect(buildRequest(action, 'p1', '', 0, '', { tileId: 'zhitna' })).toEqual({
        type: action,
        playerId: 'p1',
        tileId: 'zhitna',
      });
      expect(buildRequest(action, 'p1', '', 0, '')).toBeNull();
      expect(buildRequest(action, 'p1', '', 0, '', { tileId: '' })).toBeNull();
    }
  });

  it('sends the agreed price of a purchase only when there is one', () => {
    expect(
      buildRequest('PROPERTY_PURCHASE', 'p1', '', 0, '', { tileId: 'zhitna', priceOverride: 1 }),
    ).toMatchObject({ priceOverride: 1 });
    expect(
      buildRequest('PROPERTY_PURCHASE', 'p1', '', 0, '', { tileId: 'zhitna' }),
    ).not.toHaveProperty('priceOverride');
  });

  it('builds a build or a sale from the final levels, ignoring empty targets', () => {
    for (const action of ['PROPERTY_BUILD', 'PROPERTY_SELL_BUILDING'] as const) {
      expect(
        buildRequest(action, 'p1', '', 0, '', {
          targets: { zhitna: 2, nagatinska: 1 },
          tileId: 'x',
        }),
      ).toEqual({ type: action, playerId: 'p1', targets: { zhitna: 2, nagatinska: 1 } });
      expect(buildRequest(action, 'p1', '', 0, '', { targets: {} })).toBeNull();
      expect(buildRequest(action, 'p1', '', 0, '', { targets: {}, tileId: 'zhitna' })).toEqual({
        type: action,
        playerId: 'p1',
        tileId: 'zhitna',
      });
    }
  });

  it('builds a rent payment with an optional dice sum', () => {
    expect(buildRequest('PAY_RENT', 'p1', '', 0, '', { tileId: 'zhitna' })).toEqual({
      type: 'PAY_RENT',
      payerPlayerId: 'p1',
      tileId: 'zhitna',
    });
    expect(
      buildRequest('PAY_RENT', 'p1', '', 0, '', { tileId: 'power_plant', diceSum: 7 }),
    ).toEqual({
      type: 'PAY_RENT',
      payerPlayerId: 'p1',
      tileId: 'power_plant',
      diceSum: 7,
    });
    expect(buildRequest('PAY_RENT', 'p1', '', 0, '')).toBeNull();
    expect(buildRequest('PAY_RENT', 'p1', '', 0, '', { tileId: '' })).toBeNull();
  });

  it('builds a repayment only for a chosen loan, with the confirmed rate when given', () => {
    expect(buildRequest('LOAN_REPAYMENT', 'p1', '', 40, '', { loanId: 'l1' })).toEqual({
      type: 'LOAN_REPAYMENT',
      playerId: 'p1',
      loanId: 'l1',
      amount: 40,
    });
    expect(
      buildRequest('LOAN_REPAYMENT', 'p1', '', 40, '', { loanId: 'l1', interestRatePercent: 0 }),
    ).toMatchObject({ interestRatePercent: 0 });
    expect(buildRequest('LOAN_REPAYMENT', 'p1', '', 40, '')).toBeNull();
    expect(buildRequest('LOAN_REPAYMENT', 'p1', '', 40, '', { loanId: '' })).toBeNull();
  });

  it('builds a bank loan with the cooldown acknowledgement only when it is true', () => {
    expect(buildRequest('BANK_LOAN', 'p1', '', 400, '')).toEqual({
      type: 'LOAN_ISSUE',
      lenderKind: 'BANK',
      playerId: 'p1',
      amount: 400,
    });
    expect(
      buildRequest('BANK_LOAN', 'p1', '', 400, '', { acknowledgeCooldown: true }),
    ).toMatchObject({ acknowledgeCooldown: true });
    expect(
      buildRequest('BANK_LOAN', 'p1', '', 400, '', { acknowledgeCooldown: false }),
    ).not.toHaveProperty('acknowledgeCooldown');
  });

  it('never builds a trade from the single-amount form', () => {
    expect(buildRequest('PROPERTY_TRANSFER', 'p1', 'p2', 10, '', { tileId: 'zhitna' })).toBeNull();
  });
});

describe('previewBalances for every request type', () => {
  const deltas = (previews: ReturnType<typeof previewBalances>) =>
    previews.map((entry) => entry.delta);
  const afters = (previews: ReturnType<typeof previewBalances>) =>
    previews.map((entry) => entry.after);

  it('keeps the player and reports the balance after the change', () => {
    const preview = previewBalances(
      { type: 'PLAYER_TO_PLAYER', sourcePlayerId: 'p1', destinationPlayerId: 'p2', amount: 30 },
      players,
      200,
    );
    expect(preview.map((entry) => entry.player)).toEqual(players);
    expect(afters(preview)).toEqual([970, 530, 100]);
  });

  it('charges a bank payment to one wallet and a bank income to one wallet', () => {
    expect(
      deltas(previewBalances({ type: 'PLAYER_TO_BANK', playerId: 'p2', amount: 30 }, players, 200)),
    ).toEqual([0, -30, 0]);
    expect(
      deltas(previewBalances({ type: 'BANK_TO_PLAYER', playerId: 'p2', amount: 30 }, players, 200)),
    ).toEqual([0, 30, 0]);
    expect(
      deltas(previewBalances({ type: 'TO_JACKPOT', playerId: 'p3', amount: 30 }, players, 200)),
    ).toEqual([0, 0, -30]);
  });

  it('pays out the whole pot to the collector', () => {
    expect(
      deltas(
        previewBalances(
          { type: 'JACKPOT_PAYOUT', playerId: 'p2', expectedAmount: 90 },
          players,
          200,
          0,
          [],
          0,
          90,
        ),
      ),
    ).toEqual([0, 90, 0]);
  });

  it('charges everyone or one player in the all-player payments', () => {
    expect(
      deltas(
        previewBalances(
          { type: 'PLAYER_TO_ALL', payerPlayerId: 'p1', amountPerPlayer: 20 },
          players,
          200,
        ),
      ),
    ).toEqual([-40, 20, 20]);
    expect(
      deltas(
        previewBalances(
          { type: 'ALL_TO_PLAYER', recipientPlayerId: 'p1', amountPerPlayer: 20 },
          players,
          200,
        ),
      ),
    ).toEqual([40, -20, -20]);
  });

  it('pays the Pass GO reward given, not the game default', () => {
    expect(deltas(previewBalances({ type: 'PASS_GO', playerId: 'p3' }, players, 400))).toEqual([
      0, 0, 400,
    ]);
  });

  it('pays a mortgage the typed amount, or the tile value for a board mortgage', () => {
    expect(
      deltas(
        previewBalances(
          { type: 'MORTGAGE', playerId: 'p1', propertyName: 'X', amount: 70 },
          players,
          200,
        ),
      ),
    ).toEqual([70, 0, 0]);
    expect(
      deltas(
        previewBalances(
          { type: 'MORTGAGE', playerId: 'p1', tileId: 'zhitna' },
          players,
          200,
          0,
          [],
          0,
          0,
          { amount: 300 },
        ),
      ),
    ).toEqual([300, 0, 0]);
  });

  it('charges a purchase and a build the tile amount and pays a sale', () => {
    const tile = { amount: 250 };
    for (const type of ['PROPERTY_PURCHASE', 'PROPERTY_BUILD'] as const)
      expect(
        deltas(
          previewBalances(
            { type, playerId: 'p2', tileId: 'zhitna' },
            players,
            200,
            0,
            [],
            0,
            0,
            tile,
          ),
        ),
      ).toEqual([0, -250, 0]);
    expect(
      deltas(
        previewBalances(
          { type: 'PROPERTY_SELL_BUILDING', playerId: 'p2', tileId: 'zhitna' },
          players,
          200,
          0,
          [],
          0,
          0,
          tile,
        ),
      ),
    ).toEqual([0, 250, 0]);
  });

  it('moves rent from the payer to the owner, and charges only the payer when the owner is unknown', () => {
    const request = { type: 'PAY_RENT', payerPlayerId: 'p1', tileId: 'zhitna' } as const;
    expect(
      deltas(
        previewBalances(request, players, 200, 0, [], 0, 0, { amount: 60, ownerPlayerId: 'p3' }),
      ),
    ).toEqual([-60, 0, 60]);
    expect(deltas(previewBalances(request, players, 200, 0, [], 0, 0, { amount: 60 }))).toEqual([
      -60, 0, 0,
    ]);
    expect(
      deltas(
        previewBalances(request, players, 200, 0, [], 0, 0, { amount: 60, ownerPlayerId: null }),
      ),
    ).toEqual([-60, 0, 0]);
  });

  it('charges a redemption the cost given', () => {
    expect(
      deltas(
        previewBalances(
          { type: 'MORTGAGE_REDEMPTION', playerId: 'p1', mortgageId: 'm' },
          players,
          200,
          330,
        ),
      ),
    ).toEqual([-330, 0, 0]);
  });

  it('moves no money for a player loan request and pays a bank loan at once', () => {
    expect(
      deltas(
        previewBalances(
          { type: 'LOAN_ISSUE', borrowerPlayerId: 'p1', lenderPlayerId: 'p2', amount: 90 },
          players,
          200,
        ),
      ),
    ).toEqual([0, 0, 0]);
    expect(
      deltas(
        previewBalances(
          { type: 'LOAN_ISSUE', lenderKind: 'BANK', playerId: 'p1', amount: 90 },
          players,
          200,
        ),
      ),
    ).toEqual([90, 0, 0]);
  });

  it('pays a repayment to the lender, with the interest leaving the game', () => {
    const loan = (lenderPlayerId: string | null): Loan => ({
      id: 'l1',
      gameId: 'g1',
      lenderKind: lenderPlayerId === null ? 'BANK' : 'PLAYER',
      lenderPlayerId,
      borrowerPlayerId: 'p1',
      principal: 100,
      repaidAmount: 0,
      state: 'ACTIVE',
      createdAt: '',
      closedAt: null,
    });
    const request = { type: 'LOAN_REPAYMENT', playerId: 'p1', loanId: 'l1', amount: 40 } as const;
    expect(deltas(previewBalances(request, players, 200, 0, [loan('p2')], 0))).toEqual([
      -40, 40, 0,
    ]);
    expect(deltas(previewBalances(request, players, 200, 0, [loan(null)], 8))).toEqual([-48, 0, 0]);
    expect(deltas(previewBalances(request, players, 200, 0, [], 0))).toEqual([-40, 0, 0]);
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

describe('isPositiveInteger', () => {
  it.each(['1', '10', '9007199254740991'])('accepts %j', (value) => {
    expect(isPositiveInteger(value)).toBe(true);
  });

  it.each(['', '0', '-1', '1.5', '12a', 'a12', ' 1', '1 ', '1e3', '+5', '9007199254740993', '٣'])(
    'rejects %j',
    (value) => {
      expect(isPositiveInteger(value)).toBe(false);
    },
  );
});

describe('preflight checks', () => {
  const funds = (action: ActionType | null, amount: number, who: Player = alice) =>
    preflightFundsError(action, who, players, amount, 'USD', t);
  const short = (action: ActionType | null, amount: number, who: Player = alice) =>
    preflightShortfall(action, who, players, amount);
  const spending: ActionType[] = [
    'PLAYER_TO_PLAYER',
    'PLAYER_TO_BANK',
    'MORTGAGE_REDEMPTION',
    'PROPERTY_PURCHASE',
    'PROPERTY_BUILD',
    'PAY_RENT',
    'LOAN_REPAYMENT',
  ];
  const message = (current: number, required: number) =>
    `${t('insufficientFunds')} ${t('balanceRequirement', {
      current: formatMoney(current, 'USD'),
      required: formatMoney(required, 'USD'),
    })}`;

  it.each(spending)('%s passes at exactly the balance and fails one unit above it', (action) => {
    expect(funds(action, 1_000)).toBeNull();
    expect(funds(action, 1_001)).toBe(message(1_000, 1_001));
    expect(short(action, 1_000)).toBeNull();
    expect(short(action, 1_001)).toBe(1);
    expect(short(action, 1_500)).toBe(500);
  });

  it.each([
    'BANK_TO_PLAYER',
    'PASS_GO',
    'MORTGAGE',
    'LOAN_ISSUE',
    'BANK_LOAN',
    'TO_JACKPOT',
    'JACKPOT_PAYOUT',
    'PROPERTY_SELL_BUILDING',
    null,
  ] as const)('does not check funds for %s', (action) => {
    expect(funds(action, 999_999)).toBeNull();
    expect(short(action, 999_999)).toBeNull();
  });

  it.each([0, -5, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    'ignores the amount %s',
    (amount) => {
      expect(funds('PLAYER_TO_BANK', amount)).toBeNull();
      expect(funds('PLAYER_TO_ALL', amount)).toBeNull();
      expect(funds('ALL_TO_PLAYER', amount)).toBeNull();
      expect(short('PLAYER_TO_BANK', amount)).toBeNull();
    },
  );

  it('requires the payer of everyone to cover every other player', () => {
    expect(funds('PLAYER_TO_ALL', 500)).toBeNull();
    expect(funds('PLAYER_TO_ALL', 501)).toBe(message(1_000, 1_002));
    expect(short('PLAYER_TO_ALL', 501)).toBe(2);
    expect(short('PLAYER_TO_ALL', 500)).toBeNull();
  });

  it('names every other player who cannot cover their share', () => {
    expect(funds('ALL_TO_PLAYER', 100)).toBeNull();
    expect(funds('ALL_TO_PLAYER', 101)).toBe(
      t('cannotAfford', { names: 'Carol', amount: formatMoney(101, 'USD') }),
    );
    expect(funds('ALL_TO_PLAYER', 501)).toBe(
      t('cannotAfford', { names: 'Bob, Carol', amount: formatMoney(501, 'USD') }),
    );
    expect(funds('ALL_TO_PLAYER', 600, carol)).toBe(
      t('cannotAfford', { names: 'Bob', amount: formatMoney(600, 'USD') }),
    );
  });
});

describe('insufficientMessage details', () => {
  const failure = (code: string, details?: Record<string, unknown>) =>
    new MonopolyBankApiError({ code, message: 'x', ...(details === undefined ? {} : { details }) });
  const requirement = (current: number, required: number) =>
    t('balanceRequirement', {
      current: formatMoney(current, 'USD'),
      required: formatMoney(required, 'USD'),
    });

  it('reads the available and required amounts when cash is reserved for an auction bid', () => {
    expect(
      insufficientMessage(
        failure('INSUFFICIENT_AVAILABLE_FUNDS', {
          playerId: 'p2',
          available: 40,
          required: 90,
          currentBalance: 1,
          requiredAmount: 2,
        }),
        players,
        'USD',
        t,
      ),
    ).toBe(`${t('playerInsufficientFunds', { name: 'Bob' })} ${requirement(40, 90)}`);
  });

  it('reads the balance and required amount for a plain shortage', () => {
    expect(
      insufficientMessage(
        failure('INSUFFICIENT_FUNDS', {
          playerId: 'p1',
          currentBalance: 10,
          requiredAmount: 20,
          available: 1,
          required: 2,
        }),
        players,
        'USD',
        t,
      ),
    ).toBe(`${t('playerInsufficientFunds', { name: 'Alice' })} ${requirement(10, 20)}`);
  });

  it('falls back to the generic text without a known player or without numbers', () => {
    expect(
      insufficientMessage(
        failure('INSUFFICIENT_FUNDS', {
          playerId: 'ghost',
          currentBalance: 10,
          requiredAmount: 20,
        }),
        players,
        'USD',
        t,
      ),
    ).toBe(`${t('insufficientFunds')} ${requirement(10, 20)}`);
    expect(
      insufficientMessage(failure('INSUFFICIENT_FUNDS', { playerId: 7 }), players, 'USD', t),
    ).toBe(t('insufficientFunds'));
    expect(insufficientMessage(failure('INSUFFICIENT_FUNDS'), players, 'USD', t)).toBe(
      t('insufficientFunds'),
    );
    expect(
      insufficientMessage(
        failure('INSUFFICIENT_FUNDS', { playerId: 'p1', currentBalance: '10', requiredAmount: 20 }),
        players,
        'USD',
        t,
      ),
    ).toBe(t('playerInsufficientFunds', { name: 'Alice' }));
    expect(
      insufficientMessage(
        failure('INSUFFICIENT_FUNDS', { playerId: 'p1', currentBalance: 10 }),
        players,
        'USD',
        t,
      ),
    ).toBe(t('playerInsufficientFunds', { name: 'Alice' }));
  });
});

describe('lobbyNeedsMorePlayers', () => {
  it('asks for more players below the minimum and not from it', () => {
    expect(MIN_PLAYERS_TO_START).toBe(2);
    expect(lobbyNeedsMorePlayers(0)).toBe(true);
    expect(lobbyNeedsMorePlayers(1)).toBe(true);
    expect(lobbyNeedsMorePlayers(2)).toBe(false);
    expect(lobbyNeedsMorePlayers(6)).toBe(false);
  });
});

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
