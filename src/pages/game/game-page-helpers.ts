import type {
  GameDetails,
  PaymentRequest,
  PlayerControllerKind,
  PlayerTransactionRequest,
} from '../../../shared/contracts/api';
import type { LiveServerEvent } from '../../../shared/contracts/live';
import type {
  Currency,
  InterestRatePercent,
  Loan,
  Player,
  Transaction,
  TransactionType,
} from '../../../shared/types/monopoly';
import { MonopolyBankApiError } from '../../api/monopoly-bank-api';
import type { Translate } from '../../i18n/translations';
import { newerAuction } from '../../utils/auction';
import { formatMoney } from '../../utils/money';

/** A wallet action the banking dialog can start; a reversal is started from the history instead. */
export type ActionType = PlayerTransactionRequest['type'] | 'BANK_LOAN';

/** One player's balance before and after a previewed transaction. */
export interface BalancePreview {
  player: Player;
  delta: number;
  after: number;
}

export const primaryWalletActions: ActionType[] = [
  'PLAYER_TO_PLAYER',
  'PLAYER_TO_BANK',
  'BANK_TO_PLAYER',
  'PASS_GO',
];
export const advancedWalletActions: ActionType[] = [
  'PLAYER_TO_ALL',
  'ALL_TO_PLAYER',
  'MORTGAGE',
  'MORTGAGE_REDEMPTION',
];
/** Player-loan actions; offered only when the game enables the player-loans rule. */
export const loanWalletActions: ActionType[] = ['LOAN_ISSUE', 'LOAN_REPAYMENT'];
/** Borrowing from the bank; offered only when the game enables the bank-loans rule. */
export const bankLoanWalletActions: ActionType[] = ['BANK_LOAN'];

export function walletActionTone(action: ActionType): 'income' | 'expense' {
  return action === 'BANK_TO_PLAYER' ||
    action === 'ALL_TO_PLAYER' ||
    action === 'PASS_GO' ||
    action === 'MORTGAGE' ||
    action === 'BANK_LOAN' ||
    action === 'LOAN_ISSUE' ||
    action === 'JACKPOT_PAYOUT'
    ? 'income'
    : 'expense';
}

/**
 * Splits the pending requests into those a wallet of the viewer must answer and the viewer's own
 * loan requests still waiting for a lender. Without any known wallet everything counts as incoming.
 */
export function splitPaymentRequests(
  requests: PaymentRequest[],
  controlledPlayerIds: string[],
): { incoming: PaymentRequest[]; outgoingLoans: PaymentRequest[] } {
  const controlled = new Set(controlledPlayerIds);
  return {
    incoming:
      controlled.size === 0
        ? requests
        : requests.filter((request) => controlled.has(request.approverPlayerId)),
    outgoingLoans: requests.filter(
      (request) =>
        request.kind === 'LOAN' &&
        controlled.has(request.creatorPlayerId) &&
        !controlled.has(request.approverPlayerId),
    ),
  };
}

export function transactionInvolvesPlayer(transaction: Transaction, playerId: string): boolean {
  return transaction.participants.some((participant) => participant.playerId === playerId);
}

export function filterTransactionsForPlayer(
  transactions: Transaction[],
  playerId: string | null,
): Transaction[] {
  return playerId === null
    ? transactions
    : transactions.filter((transaction) => transactionInvolvesPlayer(transaction, playerId));
}

export function applyLiveEvent(
  event: LiveServerEvent,
  setDetails: React.Dispatch<React.SetStateAction<GameDetails | null>>,
) {
  if (event.type === 'GAME_SNAPSHOT') {
    setDetails((current) => withClientGameDetails(event.state.details, current));
    return;
  }
  if (event.type === 'LOBBY_UPDATED') {
    setDetails((current) =>
      current === null
        ? current
        : { ...current, game: event.details.game, players: event.details.players },
    );
    return;
  }
  if (event.type === 'GAME_COMMITTED') {
    setDetails((current) =>
      current === null
        ? current
        : {
            ...current,
            players: event.players,
            ...(event.mortgages === undefined ? {} : { mortgages: event.mortgages }),
            ...(event.loans === undefined ? {} : { loans: event.loans }),
            ...(event.bankLoanCooldowns === undefined
              ? {}
              : { bankLoanCooldowns: event.bankLoanCooldowns }),
            ...(event.jackpot === undefined ? {} : { jackpot: event.jackpot }),
          },
    );
    return;
  }
  if (event.type === 'AUCTION_UPDATED') {
    setDetails((current) =>
      current === null
        ? current
        : { ...current, auction: newerAuction(current.auction ?? null, event.auction) },
    );
    return;
  }
  if (event.type === 'GAME_FINISHED')
    setDetails((current) => withClientGameDetails(event.details, current));
}

export function withClientGameDetails(
  details: GameDetails,
  current: GameDetails | null,
): GameDetails {
  return current === null
    ? details
    : {
        ...details,
        canManage: current.canManage,
        joinCode: current.joinCode,
        controlledWallets: details.controlledWallets ?? current.controlledWallets,
        controlledPlayerIds: details.controlledPlayerIds ?? current.controlledPlayerIds,
      };
}

export function controllerLabel(kind: PlayerControllerKind, t: Translate): string {
  return kind === 'PRIMARY' ? t('primaryWallet') : t('localWallet');
}

export function buildRequest(
  action: ActionType,
  playerId: string,
  targetId: string,
  amount: number,
  comment: string,
  options: {
    exactLanding?: boolean;
    /** The mortgaged property's name (MORTGAGE) */
    propertyName?: string;
    /** The mortgage being redeemed (MORTGAGE_REDEMPTION) */
    mortgageId?: string;
    /** The loan being repaid (LOAN_REPAYMENT) */
    loanId?: string;
    /** The rate confirmed for a bank-loan repayment; omitted for a player loan. */
    interestRatePercent?: InterestRatePercent;
    /** The player confirmed the warning about borrowing again during the cooldown (BANK_LOAN). */
    acknowledgeCooldown?: boolean;
  } = {},
): PlayerTransactionRequest | null {
  const optionalComment = comment.trim() === '' ? {} : { comment: comment.trim() };
  switch (action) {
    case 'PLAYER_TO_PLAYER':
      return targetId === ''
        ? null
        : {
            type: action,
            sourcePlayerId: playerId,
            destinationPlayerId: targetId,
            amount,
            ...optionalComment,
          };
    case 'PLAYER_TO_BANK':
    case 'BANK_TO_PLAYER':
    case 'TO_JACKPOT':
      return { type: action, playerId, amount, ...optionalComment };
    case 'JACKPOT_PAYOUT':
      // The pot the player reviewed; the Worker refuses the collection if the pot has changed.
      return { type: action, playerId, expectedAmount: amount };
    case 'PLAYER_TO_ALL':
      return { type: action, payerPlayerId: playerId, amountPerPlayer: amount, ...optionalComment };
    case 'ALL_TO_PLAYER':
      return {
        type: action,
        recipientPlayerId: playerId,
        amountPerPlayer: amount,
        ...optionalComment,
      };
    case 'PASS_GO':
      return {
        type: action,
        playerId,
        ...(options.exactLanding === true ? { exactLanding: true } : {}),
        ...optionalComment,
      };
    case 'MORTGAGE':
      // The bank records the property name as the comment, so no separate note is sent.
      return { type: action, playerId, propertyName: options.propertyName ?? '', amount };
    case 'MORTGAGE_REDEMPTION':
      return options.mortgageId === undefined || options.mortgageId === ''
        ? null
        : { type: action, playerId, mortgageId: options.mortgageId };
    case 'LOAN_ISSUE':
      return targetId === ''
        ? null
        : { type: action, borrowerPlayerId: playerId, lenderPlayerId: targetId, amount };
    case 'LOAN_REPAYMENT':
      return options.loanId === undefined || options.loanId === ''
        ? null
        : {
            type: action,
            playerId,
            loanId: options.loanId,
            amount,
            ...(options.interestRatePercent === undefined
              ? {}
              : { interestRatePercent: options.interestRatePercent }),
          };
    case 'BANK_LOAN':
      return {
        type: 'LOAN_ISSUE',
        lenderKind: 'BANK',
        playerId,
        amount,
        ...(options.acknowledgeCooldown === true ? { acknowledgeCooldown: true } : {}),
      };
  }
}

export function previewBalances(
  request: PlayerTransactionRequest,
  players: Player[],
  passGoReward: number,
  /** What redeeming the chosen mortgage will cost (mortgage value plus 10%). */
  redemptionAmount = 0,
  /** The active loans, to find who receives a repayment. */
  loans: Loan[] = [],
  /** Interest leaving the game with a bank-loan repayment, on top of the principal. */
  interest = 0,
  /** The Free Parking pot a collection pays out in full. */
  jackpot = 0,
): BalancePreview[] {
  return players.map((player) => {
    let delta = 0;
    switch (request.type) {
      case 'PLAYER_TO_PLAYER':
        if (player.id === request.sourcePlayerId) delta = -request.amount;
        if (player.id === request.destinationPlayerId) delta = request.amount;
        break;
      case 'PLAYER_TO_BANK':
        if (player.id === request.playerId) delta = -request.amount;
        break;
      case 'BANK_TO_PLAYER':
        if (player.id === request.playerId) delta = request.amount;
        break;
      case 'TO_JACKPOT':
        if (player.id === request.playerId) delta = -request.amount;
        break;
      case 'JACKPOT_PAYOUT':
        if (player.id === request.playerId) delta = jackpot;
        break;
      case 'PLAYER_TO_ALL':
        if (player.id === request.payerPlayerId)
          delta = -request.amountPerPlayer * (players.length - 1);
        else delta = request.amountPerPlayer;
        break;
      case 'ALL_TO_PLAYER':
        if (player.id === request.recipientPlayerId)
          delta = request.amountPerPlayer * (players.length - 1);
        else delta = -request.amountPerPlayer;
        break;
      case 'PASS_GO':
        if (player.id === request.playerId) delta = passGoReward;
        break;
      case 'MORTGAGE':
        if (player.id === request.playerId) delta = request.amount;
        break;
      case 'MORTGAGE_REDEMPTION':
        if (player.id === request.playerId) delta = -redemptionAmount;
        break;
      case 'LOAN_ISSUE':
        // A player loan is only a request: no money moves until the lender accepts. The bank pays at once.
        if (request.lenderKind === 'BANK' && player.id === request.playerId) delta = request.amount;
        break;
      case 'LOAN_REPAYMENT': {
        const lenderId = loans.find((loan) => loan.id === request.loanId)?.lenderPlayerId;
        if (player.id === request.playerId) delta = -(request.amount + interest);
        if (lenderId !== null && lenderId !== undefined && player.id === lenderId)
          delta = request.amount;
        break;
      }
    }
    return { player, delta, after: player.balance + delta };
  });
}

export function actionLabel(type: ActionType, t: Translate): string {
  return {
    PLAYER_TO_PLAYER: t('payPlayer'),
    PLAYER_TO_BANK: t('payBank'),
    BANK_TO_PLAYER: t('bankPayment'),
    PLAYER_TO_ALL: t('payEveryone'),
    ALL_TO_PLAYER: t('everyonePaysMe'),
    PASS_GO: t('passGo'),
    MORTGAGE: t('mortgageProperty'),
    MORTGAGE_REDEMPTION: t('redeemMortgage'),
    LOAN_ISSUE: t('loanBorrow'),
    LOAN_REPAYMENT: t('loanRepay'),
    BANK_LOAN: t('loanBorrowBank'),
    TO_JACKPOT: t('payFreeParking'),
    JACKPOT_PAYOUT: t('collectFreeParking'),
  }[type];
}

export function actionDescription(action: ActionType, name: string, t: Translate): string {
  const key = (
    {
      PLAYER_TO_PLAYER: 'actionPayPlayer',
      PLAYER_TO_BANK: 'actionPayBank',
      BANK_TO_PLAYER: 'actionReceiveBank',
      PLAYER_TO_ALL: 'actionPayEveryone',
      ALL_TO_PLAYER: 'actionEveryonePays',
      PASS_GO: 'actionPassGo',
      MORTGAGE: 'actionMortgage',
      MORTGAGE_REDEMPTION: 'actionRedeemMortgage',
      LOAN_ISSUE: 'actionLoanIssue',
      LOAN_REPAYMENT: 'actionLoanRepay',
      BANK_LOAN: 'actionBankLoan',
      TO_JACKPOT: 'actionToJackpot',
      JACKPOT_PAYOUT: 'actionJackpotPayout',
    } as const
  )[action];
  return t(key, { name });
}

export function sourceFor(
  action: ActionType,
  player: Player,
  t: Translate,
  target: Player | null = null,
): string {
  if (action === 'LOAN_ISSUE') return target?.name ?? t('selectedPlayer');
  if (
    action === 'BANK_TO_PLAYER' ||
    action === 'PASS_GO' ||
    action === 'MORTGAGE' ||
    action === 'BANK_LOAN'
  )
    return t('bank');
  if (action === 'ALL_TO_PLAYER') return t('allOtherPlayers');
  if (action === 'JACKPOT_PAYOUT') return t('freeParkingPot');
  return player.name;
}

export function destinationFor(
  action: ActionType,
  player: Player,
  target: Player | null,
  t: Translate,
  /** The loan being repaid belongs to the bank, so there is no lender to name. */
  lenderIsBank = false,
): string {
  if (
    action === 'PLAYER_TO_BANK' ||
    action === 'MORTGAGE_REDEMPTION' ||
    (action === 'LOAN_REPAYMENT' && lenderIsBank)
  )
    return t('bank');
  if (action === 'PLAYER_TO_ALL') return t('allOtherPlayers');
  if (action === 'TO_JACKPOT') return t('freeParkingPot');
  if (action === 'PLAYER_TO_PLAYER' || action === 'LOAN_REPAYMENT')
    return target?.name ?? t('selectedPlayer');
  return player.name;
}

export function transactionLabel(type: TransactionType, t: Translate): string {
  return {
    PLAYER_TO_PLAYER: t('playerPayment'),
    PLAYER_TO_BANK: t('paidBank'),
    BANK_TO_PLAYER: t('receivedFromBank'),
    PLAYER_TO_ALL: t('paidEveryone'),
    ALL_TO_PLAYER: t('everyonePaidPlayer'),
    PAY_RENT: t('paidRent'),
    PASS_GO: t('passedGo'),
    BANKRUPTCY_TRANSFER: t('bankruptcyTransfer'),
    REVERSAL: t('reversal'),
    MORTGAGE: t('mortgageLabel'),
    MORTGAGE_REDEMPTION: t('redemptionLabel'),
    LOAN_ISSUE: t('loanIssueLabel'),
    LOAN_REPAYMENT: t('loanRepaymentLabel'),
    TO_JACKPOT: t('paidFreeParking'),
    JACKPOT_PAYOUT: t('collectedFreeParking'),
    AUCTION_PAYMENT: t('auctionPaymentLabel'),
  }[type];
}

export function isPositiveInteger(value: string) {
  return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
}

export function preflightFundsError(
  action: ActionType | null,
  player: Player,
  players: Player[],
  amount: number,
  currency: Currency,
  t: Translate,
) {
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;
  if (action === 'PLAYER_TO_ALL') {
    const required = amount * (players.length - 1);
    return player.balance < required
      ? `${t('insufficientFunds')} ${t('balanceRequirement', { current: formatMoney(player.balance, currency), required: formatMoney(required, currency) })}`
      : null;
  }
  if (action === 'ALL_TO_PLAYER') {
    const payers = players.filter(
      (candidate) => candidate.id !== player.id && candidate.balance < amount,
    );
    return payers.length === 0
      ? null
      : t('cannotAfford', {
          names: payers.map((payer) => payer.name).join(', '),
          amount: formatMoney(amount, currency),
        });
  }
  if (
    action === 'PLAYER_TO_PLAYER' ||
    action === 'PLAYER_TO_BANK' ||
    action === 'MORTGAGE_REDEMPTION' ||
    action === 'LOAN_REPAYMENT'
  ) {
    return player.balance < amount
      ? `${t('insufficientFunds')} ${t('balanceRequirement', { current: formatMoney(player.balance, currency), required: formatMoney(amount, currency) })}`
      : null;
  }
  return null;
}

/** How much the acting player is short of their own payment, or `null` when they can afford it. */
export function preflightShortfall(
  action: ActionType | null,
  player: Player,
  players: Player[],
  amount: number,
): number | null {
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;
  const required =
    action === 'PLAYER_TO_ALL'
      ? amount * (players.length - 1)
      : action === 'PLAYER_TO_PLAYER' ||
          action === 'PLAYER_TO_BANK' ||
          action === 'MORTGAGE_REDEMPTION' ||
          action === 'LOAN_REPAYMENT'
        ? amount
        : null;
  return required !== null && player.balance < required ? required - player.balance : null;
}

export function insufficientMessage(
  error: unknown,
  players: Player[],
  currency: Currency,
  t: Translate,
) {
  if (
    !(error instanceof MonopolyBankApiError) ||
    (error.code !== 'INSUFFICIENT_FUNDS' && error.code !== 'INSUFFICIENT_AVAILABLE_FUNDS')
  )
    return null;
  // Spending cash reserved for a leading auction bid reports `available` and `required`.
  const reserved = error.code === 'INSUFFICIENT_AVAILABLE_FUNDS';
  const current = reserved ? error.details?.available : error.details?.currentBalance;
  const required = reserved ? error.details?.required : error.details?.requiredAmount;
  const playerId = error.details?.playerId;
  const player =
    typeof playerId === 'string'
      ? players.find((candidate) => candidate.id === playerId)
      : undefined;
  const prefix =
    player === undefined
      ? t('insufficientFunds')
      : t('playerInsufficientFunds', { name: player.name });
  return typeof current === 'number' && typeof required === 'number'
    ? `${prefix} ${t('balanceRequirement', { current: formatMoney(current, currency), required: formatMoney(required, currency) })}`
    : prefix;
}
