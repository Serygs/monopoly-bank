import { useRef, useState } from 'react';
import type { TradeRequest } from '../../../shared/contracts/api';
import type { BoardSnapshot } from '../../../shared/board';
import type { Currency, GameProperty, Player } from '../../../shared/types/monopoly';
import { monopolyBankApi } from '../../api/monopoly-bank-api';
import { AmountSelector } from '../../components/AmountSelector';
import { Dialog } from '../../components/Dialog';
import { TradeSummary } from '../../components/game/TradeSummary';
import { Button, SheetActions, DialogBody, Notice, ToggleRow } from '../../components/ui';
import { cx } from '../../components/ui/class-names';
import { apiErrorMessage } from '../../i18n/api-errors';
import { useLanguage } from '../../i18n/language-context';
import { formatMoney } from '../../utils/money';
import { tileViews, type TileView } from '../../utils/property-view';
import { tradeOutcome } from '../../utils/trade-view';
import { PlayerPicker } from './PlayerPicker';
import { TileMultiPicker } from './TilePicker';

export interface TradeDialogProps {
  gameId: string;
  /** The wallet that makes the trade (gives first, takes second). */
  player: Player;
  players: Player[];
  currency: Currency;
  board: BoardSnapshot;
  properties: readonly GameProperty[];
  /** The tile the quick entry started from: one of the player's own (given) or another's (asked for). */
  initialTileId?: string;
  onClose: () => void;
  /** The request was sent; nothing moves until the counterparty accepts. */
  onRequested: (request: TradeRequest) => void;
  /** The proposer withdrew the pending request. */
  onCancelled?: (request: TradeRequest) => void;
}

const isAmount = (value: string) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value));

const selectorClass = cx(
  'mx-0 my-(--mb-space-3) flex min-h-14 w-full cursor-pointer items-center justify-between gap-(--mb-space-3) rounded-control border border-border bg-surface-elevated px-(--mb-space-3) py-(--mb-space-2) text-start font-ui text-primary',
  'focus-visible:outline-offset-2',
);

/** A trade is proposed here; the counterparty accepts it from their own device. */
export function TradeDialog({
  gameId,
  player,
  players,
  currency,
  board,
  properties,
  initialTileId = '',
  onClose,
  onRequested,
  onCancelled,
}: TradeDialogProps) {
  const { t } = useLanguage();
  const views = tileViews(board, properties);
  const initialView = views.find((view) => view.tile.id === initialTileId);
  const initialTheirs =
    initialView?.ownerPlayerId != null && initialView.ownerPlayerId !== player.id
      ? initialView.ownerPlayerId
      : '';
  const others = players.filter(
    (candidate) => candidate.id !== player.id && candidate.status !== 'BANKRUPT',
  );
  const [counterpartyId, setCounterpartyId] = useState(
    initialTheirs !== '' ? initialTheirs : others.length === 1 ? (others[0]?.id ?? '') : '',
  );
  const [choosingPlayer, setChoosingPlayer] = useState(counterpartyId === '');
  const [give, setGive] = useState<string[]>(
    initialView?.ownerPlayerId === player.id ? [initialView.tile.id] : [],
  );
  const [take, setTake] = useState<string[]>(initialTheirs !== '' ? [initialTileId] : []);
  const [payOn, setPayOn] = useState(false);
  const [pay, setPay] = useState('');
  const [getOn, setGetOn] = useState(false);
  const [get, setGet] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown | null>(null);
  const [sent, setSent] = useState<TradeRequest | null>(null);
  const commandIdRef = useRef<string | null>(null);
  const submittingRef = useRef(false);
  const counterparty = others.find((candidate) => candidate.id === counterpartyId) ?? null;
  const money = (value: number) => formatMoney(value, currency);

  const touch = () => {
    setError(null);
    commandIdRef.current = null;
  };
  // Buildings stay on the board; the classic rule forbids trading tiles of a group that has any.
  const tradable = (view: TileView) =>
    !views.some((other) => other.tile.group === view.tile.group && other.houses > 0);
  const ownGive = views.filter((view) => view.ownerPlayerId === player.id && tradable(view));
  const theirs = views.filter((view) => view.ownerPlayerId === counterpartyId && tradable(view));
  const chosen = (ids: readonly string[]) => views.filter((view) => ids.includes(view.tile.id));
  const giveViews = chosen(give);
  const takeViews = chosen(take);
  const toggleTile = (ids: string[], set: (next: string[]) => void, view: TileView) => {
    set(
      ids.includes(view.tile.id) ? ids.filter((id) => id !== view.tile.id) : [...ids, view.tile.id],
    );
    touch();
  };
  const caption = (view: TileView) =>
    view.mortgaged
      ? t('tradeMortgagedCaption', {
          fee: money(tradeOutcome(board, [view], [], 0, 0).counterpartyFee),
        })
      : t('tilePickerPrice', { amount: money(view.tile.price) });

  const cashGive = payOn && isAmount(pay) ? Number(pay) : 0;
  const cashTake = getOn && isAmount(get) ? Number(get) : 0;
  const outcome = tradeOutcome(board, giveViews, takeViews, cashGive, cashTake);
  const short =
    player.balance + outcome.proposerDelta < 0
      ? player
      : counterparty !== null && counterparty.balance + outcome.counterpartyDelta < 0
        ? counterparty
        : null;
  const cashValid = (on: boolean, value: string) => !on || isAmount(value);
  const valid =
    counterparty !== null &&
    give.length + take.length > 0 &&
    cashValid(payOn, pay) &&
    cashValid(getOn, get) &&
    short === null;
  const anyMortgaged = [...ownGive, ...theirs].some((view) => view.mortgaged);

  const submit = async () => {
    if (submittingRef.current || !valid || counterparty === null) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const commandId = commandIdRef.current ?? crypto.randomUUID();
      commandIdRef.current = commandId;
      const { tradeRequest } = await monopolyBankApi.createTradeRequest(
        gameId,
        {
          id: commandId,
          playerId: player.id,
          counterpartyPlayerId: counterparty.id,
          giveTileIds: give,
          takeTileIds: take,
          cashGive,
          cashTake,
        },
        commandId,
      );
      setSent(tradeRequest);
      onRequested(tradeRequest);
    } catch (caught) {
      setError(caught);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const cancelRequest = async () => {
    if (sent === null || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const result = await monopolyBankApi.cancelTradeRequest(gameId, sent.id, crypto.randomUUID());
      onCancelled?.(result.tradeRequest);
      onClose();
    } catch (caught) {
      setError(caught);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const title = t('tradeTitle');
  const errorNotice = error !== null && (
    <Notice tone="error">{apiErrorMessage(error, t, 'unableRecordTransaction')}</Notice>
  );
  const summary = counterparty !== null && (
    <TradeSummary
      board={board}
      currency={currency}
      proposer={player}
      counterparty={counterparty}
      giveViews={giveViews}
      takeViews={takeViews}
      cashGive={cashGive}
      cashTake={cashTake}
    />
  );

  if (sent !== null && counterparty !== null)
    return (
      <Dialog title={title} closeLabel={t('closeDialog', { title })} onClose={onClose} sheet="flow">
        <DialogBody>{t('tradeWaitingFor', { name: counterparty.name })}</DialogBody>
        {errorNotice}
        {summary}
        <SheetActions>
          <Button variant="secondary" disabled={submitting} onClick={() => void cancelRequest()}>
            {t('cancelRequest')}
          </Button>
          <Button variant="primary" disabled={submitting} onClick={onClose}>
            {t('close')}
          </Button>
        </SheetActions>
      </Dialog>
    );

  if (confirming && counterparty !== null)
    return (
      <Dialog title={title} closeLabel={t('closeDialog', { title })} onClose={onClose} sheet="flow">
        <DialogBody>{t('tradeReviewIntro')}</DialogBody>
        {errorNotice}
        {summary}
        <SheetActions>
          <Button variant="secondary" disabled={submitting} onClick={() => setConfirming(false)}>
            {t('back')}
          </Button>
          <Button variant="primary" disabled={submitting} onClick={() => void submit()}>
            {submitting ? t('recording') : error === null ? t('tradeSendRequest') : t('tryAgain')}
          </Button>
        </SheetActions>
      </Dialog>
    );

  return (
    <Dialog title={title} closeLabel={t('closeDialog', { title })} onClose={onClose} sheet="flow">
      <DialogBody>{t('tradeIntro')}</DialogBody>
      {errorNotice}
      <button
        type="button"
        className={selectorClass}
        aria-expanded={choosingPlayer}
        onClick={() => setChoosingPlayer(!choosingPlayer)}
      >
        <span className="grid min-w-0">
          <small className="text-secondary">{t('tradeWith')}</small>
          <span className="font-semibold wrap-anywhere">
            {counterparty?.name ?? t('tradeChooseCounterparty')}
          </span>
        </span>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className={cx('size-5 shrink-0 transition-transform', choosingPlayer && 'rotate-90')}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M7.5 4.5L13 10l-5.5 5.5" />
        </svg>
      </button>
      {choosingPlayer && (
        <PlayerPicker
          label={t('tradeWith')}
          players={others}
          gamePlayers={players}
          value={counterpartyId}
          currency={currency}
          onChange={(id) => {
            setCounterpartyId(id);
            setTake([]);
            setChoosingPlayer(false);
            touch();
          }}
        />
      )}
      <TileMultiPicker
        currency={currency}
        legend={t('tradeChooseGive', { name: player.name })}
        items={ownGive.map((view) => ({ view, caption: caption(view) }))}
        values={give}
        onToggle={(view) => toggleTile(give, setGive, view)}
      />
      <TileMultiPicker
        currency={currency}
        legend={t('tradeChooseTake', { name: counterparty?.name ?? t('selectedPlayer') })}
        items={theirs.map((view) => ({ view, caption: caption(view) }))}
        values={take}
        onToggle={(view) => toggleTile(take, setTake, view)}
      />
      <div className="grid">
        <ToggleRow
          label={t('tradeIPayCash')}
          checked={payOn}
          onChange={(next) => {
            setPayOn(next);
            touch();
          }}
        />
        {payOn && (
          <AmountSelector
            value={pay}
            onChange={(next) => {
              setPay(next);
              touch();
            }}
            currency={currency}
          />
        )}
        <ToggleRow
          label={t('tradeTheyPayCash')}
          checked={getOn}
          onChange={(next) => {
            setGetOn(next);
            touch();
          }}
        />
        {getOn && (
          <AmountSelector
            value={get}
            onChange={(next) => {
              setGet(next);
              touch();
            }}
            currency={currency}
          />
        )}
      </div>
      {anyMortgaged && (
        <Notice tone="info" className="my-(--mb-space-4)">
          {t('tradeFeeHint')}
        </Notice>
      )}
      {short !== null && (
        <Notice tone="error">
          {t('tradeCannotAfford', {
            name: short.name,
            amount: money(
              Math.abs(short.id === player.id ? outcome.proposerDelta : outcome.counterpartyDelta),
            ),
          })}
        </Notice>
      )}
      <SheetActions>
        <Button variant="secondary" type="button" onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button variant="primary" disabled={!valid} onClick={() => setConfirming(true)}>
          {t('tradeReview')}
        </Button>
      </SheetActions>
    </Dialog>
  );
}
