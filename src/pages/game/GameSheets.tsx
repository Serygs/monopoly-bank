import { LazyBoundary } from '../../components/app-shell/LazyBoundary';
import { lazyNamed } from '../../utils/lazy-named';
import { ActivityScreen } from '../ActivityScreen';
import type { GameContext } from './game-context';

// Opened on demand, so each loads with its first use (the service worker precaches them).
const PropertyScreen = lazyNamed(() => import('../PropertyScreen'), 'PropertyScreen');
const RulesScreen = lazyNamed(() => import('../RulesScreen'), 'RulesScreen');
const StatisticsScreen = lazyNamed(() => import('../StatisticsScreen'), 'StatisticsScreen');

function ActivitySheet({ ctx }: { ctx: GameContext }) {
  const { gameId, details, view, dialogs } = ctx;
  const { activity } = dialogs;
  return (
    <ActivityScreen
      gameId={gameId}
      players={details.players}
      currency={details.game.currency}
      liveTransactions={ctx.liveTransactions}
      showPending={view.confirmationMode}
      initialScope={activity.scope}
      initialPlayerId={activity.playerId}
      refreshKey={activity.version}
      board={view.board}
      onPullRefresh={ctx.refresh.run}
      refreshing={ctx.refresh.state === 'busy'}
      reversal={
        view.canMutate
          ? {
              isOwner: details.canManage === true,
              controlledPlayerIds: details.controlledPlayerIds ?? [],
              onReverse: activity.setReversing,
            }
          : undefined
      }
      onClose={() => {
        activity.setOpen(false);
        activity.setPlayerId(null);
      }}
    />
  );
}

function PropertySheet({ ctx }: { ctx: GameContext }) {
  const { details, view, dialogs } = ctx;
  if (view.board === null) return null;
  const actor = view.canMutate ? (view.activeWallet?.id ?? null) : null;
  return (
    <PropertyScreen
      board={view.board}
      properties={view.properties}
      players={details.players}
      currency={details.game.currency}
      controlledPlayerIds={view.controlledIds}
      initialOwner={dialogs.sheets.propertyOwner}
      actorPlayerId={actor}
      auctionsAvailable={details.game.rules.auctions && details.auction?.state !== 'ACTIVE'}
      onIntent={
        view.canMutate ? (intent) => dialogs.startTileIntent(details.players, intent) : undefined
      }
      onClose={() => {
        dialogs.sheets.setPropertyOpen(false);
        dialogs.sheets.setPropertyOwner(null);
      }}
    />
  );
}

export function GameSheets({ ctx }: { ctx: GameContext }) {
  const { details, view, dialogs } = ctx;
  const { sheets, activity } = dialogs;
  return (
    <LazyBoundary>
      {sheets.rulesOpen && (
        <RulesScreen game={details.game} onClose={() => sheets.setRulesOpen(false)} />
      )}
      {activity.open && <ActivitySheet ctx={ctx} />}
      {sheets.propertyOpen && <PropertySheet ctx={ctx} />}
      {sheets.statisticsOpen && sheets.summary !== null && (
        <StatisticsScreen
          summary={sheets.summary}
          currency={details.game.currency}
          loans={view.visibleLoans}
          finished={details.game.status === 'FINISHED'}
          onPullRefresh={ctx.refresh.run}
          refreshing={ctx.refresh.state === 'busy'}
          onClose={() => sheets.setStatisticsOpen(false)}
        />
      )}
    </LazyBoundary>
  );
}
