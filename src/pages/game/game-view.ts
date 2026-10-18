import type { BoardSnapshot } from '../../../shared/board';
import type {
  GameDetails,
  PaymentRequest,
  PlayerController,
  TradeRequest,
} from '../../../shared/contracts/api';
import type { GameProperty, Loan, Player, Transaction } from '../../../shared/types/monopoly';
import { cardsOwnedBy, tileViews, type TileView } from '../../utils/property-view';
import { selectRecentEventsForPlayer } from '../../utils/recent-events';
import { splitPaymentRequests } from './game-page-helpers';

export interface GameView {
  controlledWallets: PlayerController[];
  controlledIds: string[];
  activeControlledWalletId: string | null;
  activeWallet: Player | null;
  recentTransactions: Transaction[];
  otherPlayers: Player[];
  canMutate: boolean;
  showNav: boolean;
  confirmationMode: boolean;
  inboxRequests: PaymentRequest[];
  outgoingLoanRequests: PaymentRequest[];
  incomingTrades: TradeRequest[];
  outgoingTrades: TradeRequest[];
  visibleLoans: Loan[];
  board: BoardSnapshot | null;
  properties: GameProperty[];
  myCards: TileView[];
}

interface ViewInput {
  details: GameDetails;
  paymentRequests: PaymentRequest[];
  liveTransactions: Transaction[];
  seededTransactions: Transaction[];
  activeWalletId: string | null;
  offline: boolean;
}

function recentFor(
  wallet: Player | null,
  live: Transaction[],
  seeded: Transaction[],
): Transaction[] {
  if (wallet === null) return [];
  const fresh = seeded.filter((row) => !live.some((item) => item.id === row.id));
  return selectRecentEventsForPlayer([...live, ...fresh], wallet.id);
}

function inboxOf(details: GameDetails, requests: PaymentRequest[], controlledIds: string[]) {
  const { incoming, outgoingLoans } = splitPaymentRequests(requests, controlledIds);
  const inbox =
    details.game.paymentMode === 'CONFIRMATION'
      ? incoming
      : incoming.filter((request) => request.kind === 'LOAN');
  return { inboxRequests: inbox, outgoingLoanRequests: outgoingLoans };
}

function tradesOf(details: GameDetails, controlledIds: string[]) {
  const pending = (details.tradeRequests ?? []).filter((request) => request.state === 'PENDING');
  return {
    incomingTrades: pending.filter((request) =>
      controlledIds.includes(request.counterpartyPlayerId),
    ),
    outgoingTrades: pending.filter((request) => controlledIds.includes(request.proposerPlayerId)),
  };
}

export function deriveGameView(input: ViewInput): GameView {
  const { details, paymentRequests, activeWalletId, offline } = input;
  const controlledWallets = details.controlledWallets ?? [];
  const controlledIds =
    details.controlledPlayerIds ?? controlledWallets.map((wallet) => wallet.playerId);
  const activeControlledWalletId = controlledWallets.some(
    (wallet) => wallet.playerId === activeWalletId,
  )
    ? activeWalletId
    : (controlledWallets[0]?.playerId ?? null);
  const activeWallet =
    details.players.find((player) => player.id === activeControlledWalletId) ?? null;
  const board = details.game.settings?.board ?? null;
  const properties = details.properties ?? [];
  const rules = details.game.rules;
  return {
    controlledWallets,
    controlledIds,
    activeControlledWalletId,
    activeWallet,
    recentTransactions: recentFor(activeWallet, input.liveTransactions, input.seededTransactions),
    otherPlayers: details.players
      .filter((player) => player.id !== activeWallet?.id)
      .sort((a, b) => Number(a.status === 'BANKRUPT') - Number(b.status === 'BANKRUPT')),
    canMutate: details.game.status === 'ACTIVE' && !offline,
    showNav: details.game.status !== 'LOBBY',
    confirmationMode: details.game.paymentMode === 'CONFIRMATION',
    ...inboxOf(details, paymentRequests, controlledIds),
    ...tradesOf(details, controlledIds),
    visibleLoans: (details.loans ?? []).filter((loan) =>
      loan.lenderKind === 'BANK' ? rules.bankLoans : rules.playerLoans,
    ),
    board,
    properties,
    myCards: board === null ? [] : cardsOwnedBy(tileViews(board, properties), controlledIds),
  };
}
