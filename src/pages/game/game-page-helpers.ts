import type { MutableRefObject } from 'react';
import type {
  GameDetails,
  PlayerControllerKind,
  PlayerTransactionRequest,
} from '../../../shared/contracts/api';
import type { LiveServerEvent } from '../../../shared/contracts/live';
import type {
  Currency,
  Player,
  Transaction,
  TransactionType,
} from '../../../shared/types/monopoly';
import { MonopolyBankApiError } from '../../api/monopoly-bank-api';
import type { Translate } from '../../i18n/translations';
import { formatMoney } from '../../utils/money';

/** A wallet action the banking dialog can start; a reversal is started from the history instead. */
export type ActionType = PlayerTransactionRequest['type'];

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

export function walletActionTone(action: ActionType): 'income' | 'expense' {
  return action === 'BANK_TO_PLAYER' ||
    action === 'ALL_TO_PLAYER' ||
    action === 'PASS_GO' ||
    action === 'MORTGAGE'
    ? 'income'
    : 'expense';
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

/** `historyPlayerId` is the player whose history dialog is open, or null for the whole game. */
export function applyLiveEvent(
  event: LiveServerEvent,
  setDetails: React.Dispatch<React.SetStateAction<GameDetails | null>>,
  setHistory: React.Dispatch<React.SetStateAction<Transaction[] | null>>,
  historyCache: MutableRefObject<Map<string, Transaction[]>>,
  historyPlayerId: string | null = null,
) {
  if (event.type === 'GAME_SNAPSHOT') {
    historyCache.current.set('all', event.state.transactions);
    setDetails((current) => withClientGameDetails(event.state.details, current));
    setHistory(filterTransactionsForPlayer(event.state.transactions, historyPlayerId));
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
    historyCache.current.clear();
    setDetails((current) =>
      current === null
        ? current
        : {
            ...current,
            players: event.players,
            ...(event.mortgages === undefined ? {} : { mortgages: event.mortgages }),
          },
    );
    setHistory((current) => {
      if (
        current === null ||
        (historyPlayerId !== null && !transactionInvolvesPlayer(event.transaction, historyPlayerId))
      )
        return current;
      const reversed = event.transaction.reversesTransactionId;
      return [
        event.transaction,
        // A reversal marks the original it moved back, so the row stops offering "Reverse".
        ...current
          .filter((transaction) => transaction.id !== event.transaction.id)
          .map((transaction) =>
            transaction.id === reversed
              ? { ...transaction, reversedByTransactionId: event.transaction.id }
              : transaction,
          ),
      ];
    });
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
      return { type: action, playerId, amount, ...optionalComment };
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
  }
}

export function previewBalances(
  request: PlayerTransactionRequest,
  players: Player[],
  passGoReward: number,
  /** What redeeming the chosen mortgage will cost (mortgage value plus 10%). */
  redemptionAmount = 0,
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
    } as const
  )[action];
  return t(key, { name });
}

export function sourceFor(action: ActionType, player: Player, t: Translate): string {
  if (action === 'BANK_TO_PLAYER' || action === 'PASS_GO' || action === 'MORTGAGE')
    return t('bank');
  if (action === 'ALL_TO_PLAYER') return t('allOtherPlayers');
  return player.name;
}

export function destinationFor(
  action: ActionType,
  player: Player,
  target: Player | null,
  t: Translate,
): string {
  if (action === 'PLAYER_TO_BANK' || action === 'MORTGAGE_REDEMPTION') return t('bank');
  if (action === 'PLAYER_TO_ALL') return t('allOtherPlayers');
  if (action === 'PLAYER_TO_PLAYER') return target?.name ?? t('selectedPlayer');
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
    action === 'MORTGAGE_REDEMPTION'
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
          action === 'MORTGAGE_REDEMPTION'
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
  if (!(error instanceof MonopolyBankApiError) || error.code !== 'INSUFFICIENT_FUNDS') return null;
  const current = error.details?.currentBalance;
  const required = error.details?.requiredAmount;
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
