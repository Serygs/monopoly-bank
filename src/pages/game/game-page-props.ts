import type { GameDetails } from '../../../shared/contracts/api';
import { boardStrip, cardsValue, playerStrip, tileViews } from '../../utils/property-view';
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
    refresh: ctx.refresh,
    offline,
    onBack,
    onOpenActivity: () => dialogs.activity.setOpen(true),
    onOpenStatistics: dialogs.openStatistics,
    onOpenRules: () => dialogs.sheets.setRulesOpen(true),
    onInvite: () => dialogs.sheets.setInviteOpen(true),
    onFinish: () => dialogs.sheets.setFinishing(true),
  };
}

/** Board games: the viewer's Property button with a strip of every tile, and each player's cards. */
function propertyEntries(ctx: GameContext) {
  const { details, view, dialogs } = ctx;
  if (view.board === null) return { property: undefined, playerProperty: undefined };
  const views = tileViews(view.board, view.properties);
  const colors = new Map(details.players.map((player) => [player.id, player.color]));
  return {
    property: {
      count: view.myCards.length,
      value: formatMoney(cardsValue(view.myCards), details.game.currency),
      strip: boardStrip(views, view.controlledIds, colors),
      onOpen: () => dialogs.openProperty(),
    },
    playerProperty: (player: GameDetails['players'][number]) => ({
      cards: playerStrip(views, player.id),
      onOpen: () => dialogs.openProperty(player.id),
    }),
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
    ...propertyEntries(ctx),
    onSelectWallet: wallet.setActiveWalletId,
    onOpenWallet: openWallet(false),
    onSettleLoan: openWallet(true),
  };
}
