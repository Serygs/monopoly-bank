import { GameBottomNav, type GameNavDestination } from '../../components/game/GameBottomNav';
import type { GameContext } from './game-context';

function activeDestination(ctx: GameContext): GameNavDestination | null {
  const { sheets, activity, wallet } = ctx.dialogs;
  if (sheets.toolsOpen) return 'tools';
  if (activity.open) return 'activity';
  if (sheets.statisticsOpen) return 'statistics';
  if (sheets.propertyOpen) return 'property';
  return wallet.selectedPlayer !== null ? 'pay' : null;
}

export function GameNav({ ctx }: { ctx: GameContext }) {
  const { details, view, dialogs, offline } = ctx;
  const { activeWallet, canMutate } = view;
  const open = (show: () => void) => () => {
    dialogs.closeNavSheets();
    show();
  };
  const onPay = () => {
    if (activeWallet === null) return;
    dialogs.closeNavSheets();
    dialogs.wallet.setSelectedPlayer(activeWallet);
  };
  return (
    <GameBottomNav
      active={activeDestination(ctx)}
      onClose={dialogs.closeNavSheets}
      hasPending={canMutate && (view.inboxRequests.length > 0 || view.incomingTrades.length > 0)}
      property={
        view.board === null
          ? undefined
          : { onOpen: open(() => dialogs.sheets.setPropertyOpen(true)) }
      }
      payDisabled={!canMutate || activeWallet === null || activeWallet.status === 'BANKRUPT'}
      activityDisabled={offline}
      toolsDisabled={details.game.status !== 'ACTIVE'}
      onOpenTools={open(() => dialogs.sheets.setToolsOpen(true))}
      onPay={onPay}
      onOpenActivity={open(() => dialogs.activity.setOpen(true))}
      onOpenStatistics={dialogs.openStatistics}
    />
  );
}
