import { Button, Notice, useFeedback } from '../../components/ui';
import { useLanguage } from '../../i18n/language-context';
import { AuctionDialog } from './AuctionDialog';
import type { GameContext } from './game-context';
import { StartAuctionDialog } from './StartAuctionDialog';
import { TradeDialog } from './TradeDialog';

function TradePromptDialog({ ctx }: { ctx: GameContext }) {
  const { t } = useLanguage();
  const notify = useFeedback();
  const { gameId, details, view, dialogs, putTradeRequest } = ctx;
  const { tradePrompt, setTradePrompt } = dialogs.prompts;
  if (tradePrompt === null || view.board === null) return null;
  return (
    <TradeDialog
      gameId={gameId}
      player={tradePrompt.player}
      players={details.players}
      currency={details.game.currency}
      board={view.board}
      properties={view.properties}
      initialTileId={tradePrompt.tileId}
      onClose={() => setTradePrompt(null)}
      onRequested={(request) => {
        putTradeRequest(request);
        notify({ tone: 'success', message: t('tradeRequestSent') });
      }}
      onCancelled={putTradeRequest}
    />
  );
}

function StartAuctionPrompt({ ctx }: { ctx: GameContext }) {
  const { gameId, details, view, dialogs, applyAuctionResponse } = ctx;
  const { auctionPrompt, setAuctionPrompt, setDismissedAuction } = dialogs.prompts;
  if (auctionPrompt === null) return null;
  return (
    <StartAuctionDialog
      gameId={gameId}
      initiator={auctionPrompt.player}
      initialLotName={auctionPrompt.lotName}
      board={view.board}
      properties={view.properties}
      currency={details.game.currency}
      initialTileId={auctionPrompt.tileId}
      onClose={() => setAuctionPrompt(null)}
      onStarted={(response) => {
        applyAuctionResponse(response);
        setAuctionPrompt(null);
        setDismissedAuction(null);
      }}
    />
  );
}

function DismissedAuctionNotice({ ctx }: { ctx: GameContext }) {
  const { t } = useLanguage();
  const { details, dialogs } = ctx;
  const { dismissedAuction, setDismissedAuction } = dialogs.prompts;
  const { auction } = details;
  if (!details.game.rules.auctions || auction?.state !== 'ACTIVE') return null;
  if (dismissedAuction !== `${auction.id}:ACTIVE`) return null;
  return (
    <Notice tone="info" as="section">
      <p>{auction.lotName}</p>
      <Button variant="secondary" onClick={() => setDismissedAuction(null)}>
        {t('auctionDialogTitle')}
      </Button>
    </Notice>
  );
}

function RunningAuction({ ctx }: { ctx: GameContext }) {
  const { gameId, details, view, dialogs } = ctx;
  const { auction } = details;
  if (!details.game.rules.auctions || auction === null || auction === undefined) return null;
  if (details.game.status === 'LOBBY') return null;
  if (dialogs.prompts.dismissedAuction === `${auction.id}:${auction.state}`) return null;
  return (
    <AuctionDialog
      gameId={gameId}
      auction={auction}
      players={details.players}
      controlledPlayerIds={view.controlledIds}
      currency={details.game.currency}
      settings={details.game.settings}
      canMutate={view.canMutate}
      onClose={() => dialogs.prompts.setDismissedAuction(`${auction.id}:${auction.state}`)}
      onUpdated={ctx.applyAuctionResponse}
      onRefresh={ctx.refreshAuction}
    />
  );
}

export function AuctionPrompts({ ctx }: { ctx: GameContext }) {
  return (
    <>
      <DismissedAuctionNotice ctx={ctx} />
      <TradePromptDialog ctx={ctx} />
      <StartAuctionPrompt ctx={ctx} />
      <RunningAuction ctx={ctx} />
    </>
  );
}
