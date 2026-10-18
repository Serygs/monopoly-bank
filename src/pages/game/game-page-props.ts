import type { GameDetails } from '../../../shared/contracts/api';
import { cardsValue } from '../../utils/property-view';
import { formatMoney } from '../../utils/money';
import type { LiveStatus } from './GameHeader';
import type { GameContext } from './game-context';

export function headerProps(ctx: GameContext, liveStatus: LiveStatus, onBack: () => void) {
  const { details, offline, dialogs } = ctx;
  return {
    game: details.game,
    jackpot: details.jackpot,
    canManage: details.canManage,
    liveStatus,
    offline,
    onBack,
    onOpenActivity: () => dialogs.activity.setOpen(true),
    onOpenStatistics: dialogs.openStatistics,
    onOpenRules: () => dialogs.sheets.setRulesOpen(true),
    onInvite: () => dialogs.sheets.setInviteOpen(true),
    onFinish: () => dialogs.sheets.setFinishing(true),
  };
}

function propertyEntry(ctx: GameContext) {
  const { details, view, dialogs } = ctx;
  if (view.board === null) return undefined;
  return {
    count: view.myCards.length,
    value: formatMoney(cardsValue(view.myCards), details.game.currency),
    onOpen: () => {
      dialogs.closeNavSheets();
      dialogs.sheets.setPropertyOpen(true);
    },
  };
}

export function walletsProps(ctx: GameContext) {
  const { details, view, dialogs } = ctx;
  const { wallet } = dialogs;
  const openWallet = (settleLoan: boolean) => (player: GameDetails['players'][number]) => {
    wallet.setSettleLoanOnOpen(settleLoan);
    wallet.setSelectedPlayer(player);
  };
  return {
    players: details.players,
    currency: details.game.currency,
    controlledWallets: view.controlledWallets,
    activeControlledWalletId: view.activeControlledWalletId,
    activeWallet: view.activeWallet,
    otherPlayers: view.otherPlayers,
    canMutate: view.canMutate,
    loans: view.visibleLoans,
    auction: details.game.rules.auctions ? (details.auction ?? null) : null,
    recentTransactions: view.recentTransactions,
    board: view.board,
    property: propertyEntry(ctx),
    onSelectWallet: wallet.setActiveWalletId,
    onOpenWallet: openWallet(false),
    onSettleLoan: openWallet(true),
  };
}
