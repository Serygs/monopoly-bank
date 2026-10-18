import { PropertyScreen } from '../PropertyScreen';
import { ActivityScreen } from '../ActivityScreen';
import { RulesScreen } from '../RulesScreen';
import { StatisticsScreen } from '../StatisticsScreen';
import type { GameContext } from './game-context';

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
      actorPlayerId={actor}
      auctionsAvailable={details.game.rules.auctions && details.auction?.state !== 'ACTIVE'}
      onIntent={
        view.canMutate ? (intent) => dialogs.startTileIntent(details.players, intent) : undefined
      }
      onClose={() => dialogs.sheets.setPropertyOpen(false)}
    />
  );
}

export function GameSheets({ ctx }: { ctx: GameContext }) {
  const { details, view, dialogs } = ctx;
  const { sheets, activity } = dialogs;
  return (
    <>
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
          onClose={() => sheets.setStatisticsOpen(false)}
        />
      )}
    </>
  );
}
