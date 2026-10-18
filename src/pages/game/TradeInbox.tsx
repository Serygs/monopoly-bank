import { useState } from 'react';
import type { TradeRequest } from '../../../shared/contracts/api';
import type { BoardSnapshot } from '../../../shared/board';
import type { Currency, GameProperty, Player } from '../../../shared/types/monopoly';
import { Dialog } from '../../components/Dialog';
import { TradeSummary } from '../../components/game/TradeSummary';
import { Button, CountBadge, GlassSurface, Notice, SheetActions } from '../../components/ui';
import { apiErrorMessage } from '../../i18n/api-errors';
import { useLanguage } from '../../i18n/language-context';
import { tileViews } from '../../utils/property-view';
import { useAsyncAction } from '../../hooks/useAsyncAction';

export type TradeRequestAction = 'accept' | 'decline' | 'cancel';

export interface TradeInboxProps {
  /** Pending trades waiting for one of the viewer's wallets to answer. */
  incoming: TradeRequest[];
  /** The viewer's own pending proposals: "Waiting for X" with Cancel. */
  outgoing: TradeRequest[];
  players: Player[];
  currency: Currency;
  board: BoardSnapshot;
  properties: readonly GameProperty[];
  onAction: (request: TradeRequest, action: TradeRequestAction) => Promise<void>;
}

/**
 * Pending property trades next to the payment inbox. An incoming trade opens a sheet with the same
 * review the proposer saw, then Accept or Decline; an outgoing one waits with a Cancel button.
 */
export function TradeInbox({
  incoming,
  outgoing,
  players,
  currency,
  board,
  properties,
  onAction,
}: TradeInboxProps) {
  const { t } = useLanguage();
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const { busy: busy, error, run } = useAsyncAction();
  if (incoming.length === 0 && outgoing.length === 0) return null;
  const views = tileViews(board, properties);
  const nameOf = (id: string) =>
    players.find((player) => player.id === id)?.name ?? t('playerFallback');
  const reviewing = incoming.find((request) => request.id === reviewingId) ?? null;
  const proposer =
    reviewing === null ? undefined : players.find((p) => p.id === reviewing.proposerPlayerId);
  const counterparty =
    reviewing === null ? undefined : players.find((p) => p.id === reviewing.counterpartyPlayerId);

  const act = async (request: TradeRequest, action: TradeRequestAction) => {
    await run(async () => {
      await onAction(request, action);
      setReviewingId(null);
    });
  };
  const chosen = (ids: readonly string[]) => views.filter((view) => ids.includes(view.tile.id));
  const errorNotice = error !== null && (
    <Notice tone="error">{apiErrorMessage(error, t, 'unableRecordTransaction')}</Notice>
  );

  return (
    <>
      <GlassSurface
        as="section"
        tinted
        className="trade-inbox my-(--mb-space-6) grid gap-(--mb-space-3) border-accent p-(--mb-space-4) max-md:my-(--mb-space-3)"
        aria-labelledby="trade-inbox-title"
      >
        <header className="flex items-center justify-between gap-(--mb-space-3)">
          <h2 id="trade-inbox-title" className="m-0 text-heading-md">
            {t('tradeInbox')}
          </h2>
          <CountBadge>{incoming.length + outgoing.length}</CountBadge>
        </header>
        {!reviewing && errorNotice}
        <ol className="m-0 grid list-none gap-(--mb-space-2) p-0">
          {incoming.map((request) => (
            <li
              key={request.id}
              className="flex items-center justify-between gap-(--mb-space-3) rounded-control border border-border bg-surface-elevated p-(--mb-space-3) max-md:flex-col max-md:items-stretch"
            >
              <strong>{t('tradeRequestFrom', { name: nameOf(request.proposerPlayerId) })}</strong>
              <Button variant="primary" onClick={() => setReviewingId(request.id)}>
                {t('tradeReview')}
              </Button>
            </li>
          ))}
          {outgoing.map((request) => (
            <li
              key={request.id}
              className="flex items-center justify-between gap-(--mb-space-3) rounded-control border border-border bg-surface-elevated p-(--mb-space-3) max-md:flex-col max-md:items-stretch"
            >
              <strong>
                {t('tradeWaitingFor', { name: nameOf(request.counterpartyPlayerId) })}
              </strong>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void act(request, 'cancel')}
              >
                {t('cancelRequest')}
              </Button>
            </li>
          ))}
        </ol>
      </GlassSurface>
      {reviewing !== null && proposer !== undefined && counterparty !== undefined && (
        <Dialog
          title={t('tradeTitle')}
          closeLabel={t('closeDialog', { title: t('tradeTitle') })}
          onClose={() => setReviewingId(null)}
          sheet="flow"
        >
          <p className="m-0 text-secondary">
            {t('tradeRequestFrom', { name: proposer.name })} {t('tradeAcceptIntro')}
          </p>
          {errorNotice}
          <TradeSummary
            board={board}
            currency={currency}
            proposer={proposer}
            counterparty={counterparty}
            giveViews={chosen(reviewing.giveTileIds)}
            takeViews={chosen(reviewing.takeTileIds)}
            cashGive={reviewing.cashGive}
            cashTake={reviewing.cashTake}
          />
          <SheetActions>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void act(reviewing, 'decline')}
            >
              {t('tradeDecline')}
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => void act(reviewing, 'accept')}>
              {busy ? t('recording') : t('tradeAccept')}
            </Button>
          </SheetActions>
        </Dialog>
      )}
    </>
  );
}
