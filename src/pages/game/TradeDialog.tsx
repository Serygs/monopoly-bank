import { useRef, useState } from 'react';
import type { CreateTransactionResponse } from '../../../shared/contracts/api';
import type { BoardSnapshot } from '../../../shared/board';
import type { Currency, GameProperty, Player } from '../../../shared/types/monopoly';
import { redemptionCost } from '../../../shared/domain/mortgage';
import { monopolyBankApi } from '../../api/monopoly-bank-api';
import { AmountSelector } from '../../components/AmountSelector';
import { Dialog } from '../../components/Dialog';
import {
  Button,
  DialogActions,
  DialogBody,
  FieldHint,
  MoneyValue,
  Notice,
  Toggle,
} from '../../components/ui';
import { apiErrorMessage } from '../../i18n/api-errors';
import { useLanguage } from '../../i18n/language-context';
import { formatMoney } from '../../utils/money';
import { tileViews, type TileView } from '../../utils/property-view';
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
  onCompleted: (response: CreateTransactionResponse) => void;
}

const isAmount = (value: string) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value));

/** What the receiver of a mortgaged tile pays the bank at once: 10% of its mortgage value. */
function mortgageFee(view: TileView): number {
  return view.mortgaged ? redemptionCost(view.tile.mortgage) - view.tile.mortgage : 0;
}

/**
 * A trade between two wallets: tiles each way, optional cash each way, the 10% fee for every
 * mortgaged tile received, one review and one atomic operation.
 */
export function TradeDialog({
  gameId,
  player,
  players,
  currency,
  board,
  properties,
  initialTileId = '',
  onClose,
  onCompleted,
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
      ? t('tradeMortgagedCaption', { fee: money(mortgageFee(view)) })
      : t('tilePickerPrice', { amount: money(view.tile.price) });

  const cashGive = payOn && isAmount(pay) ? Number(pay) : 0;
  const cashTake = getOn && isAmount(get) ? Number(get) : 0;
  // Each side pays the bank for every mortgaged tile it receives.
  const playerFee = takeViews.reduce((sum, view) => sum + mortgageFee(view), 0);
  const counterpartyFee = giveViews.reduce((sum, view) => sum + mortgageFee(view), 0);
  const playerDelta = cashTake - cashGive - playerFee;
  const counterpartyDelta = cashGive - cashTake - counterpartyFee;
  const short =
    player.balance + playerDelta < 0
      ? player
      : counterparty !== null && counterparty.balance + counterpartyDelta < 0
        ? counterparty
        : null;
  const cashValid = (on: boolean, value: string) => !on || isAmount(value);
  const valid =
    counterparty !== null &&
    give.length + take.length > 0 &&
    cashValid(payOn, pay) &&
    cashValid(getOn, get) &&
    short === null;

  const submit = async () => {
    if (submittingRef.current || !valid || counterparty === null) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const commandId = commandIdRef.current ?? crypto.randomUUID();
      commandIdRef.current = commandId;
      const result = await monopolyBankApi.createTransaction(
        gameId,
        {
          type: 'PROPERTY_TRANSFER',
          playerId: player.id,
          counterpartyPlayerId: counterparty.id,
          giveTileIds: give,
          takeTileIds: take,
          ...(cashGive > 0 ? { cashGive } : {}),
          ...(cashTake > 0 ? { cashTake } : {}),
        },
        commandId,
      );
      if ('paymentRequests' in result) return;
      onCompleted(result);
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
  const names = (list: readonly TileView[]) =>
    list.length === 0 ? t('tradeNothing') : list.map((view) => view.tile.name).join(', ');

  if (confirming && counterparty !== null)
    return (
      <Dialog title={title} closeLabel={t('closeDialog', { title })} onClose={onClose}>
        <DialogBody>{t('tradeReviewIntro')}</DialogBody>
        {errorNotice}
        <dl className="m-0 grid gap-(--mb-space-2)">
          <div>
            <dt className="text-secondary">{t('tradeYouGive', { name: player.name })}</dt>
            <dd className="m-0 font-semibold">{names(giveViews)}</dd>
          </div>
          <div>
            <dt className="text-secondary">{t('tradeYouGet', { name: counterparty.name })}</dt>
            <dd className="m-0 font-semibold">{names(takeViews)}</dd>
          </div>
          {cashGive > 0 && (
            <div>
              <dt className="text-secondary">{t('tradeCashPaid', { name: player.name })}</dt>
              <dd className="m-0 font-semibold">{money(cashGive)}</dd>
            </div>
          )}
          {cashTake > 0 && (
            <div>
              <dt className="text-secondary">{t('tradeCashPaid', { name: counterparty.name })}</dt>
              <dd className="m-0 font-semibold">{money(cashTake)}</dd>
            </div>
          )}
          {[
            [player, playerFee],
            [counterparty, counterpartyFee],
          ].map(([who, fee]) =>
            (fee as number) > 0 ? (
              <div key={(who as Player).id}>
                <dt className="text-secondary">
                  {t('tradeFeeLine', { name: (who as Player).name })}
                </dt>
                <dd className="m-0 font-semibold">{money(fee as number)}</dd>
              </div>
            ) : null,
          )}
        </dl>
        <ul className="m-0 mt-(--mb-space-3) grid list-none gap-(--mb-space-1) p-0">
          {[
            [player, playerDelta],
            [counterparty, counterpartyDelta],
          ].map(([who, delta]) => (
            <li key={(who as Player).id} className="flex justify-between gap-(--mb-space-3)">
              <span>{(who as Player).name}</span>
              <span>
                <MoneyValue
                  amount={(who as Player).balance + (delta as number)}
                  currency={currency}
                />
              </span>
            </li>
          ))}
        </ul>
        <DialogActions>
          <Button variant="secondary" disabled={submitting} onClick={() => setConfirming(false)}>
            {t('back')}
          </Button>
          <Button variant="primary" disabled={submitting} onClick={() => void submit()}>
            {submitting ? t('recording') : error === null ? t('confirmTransaction') : t('tryAgain')}
          </Button>
        </DialogActions>
      </Dialog>
    );

  return (
    <Dialog title={title} closeLabel={t('closeDialog', { title })} onClose={onClose}>
      <DialogBody>{t('tradeIntro')}</DialogBody>
      {errorNotice}
      <PlayerPicker
        label={t('tradeWith')}
        players={others}
        gamePlayers={players}
        value={counterpartyId}
        currency={currency}
        onChange={(id) => {
          setCounterpartyId(id);
          setTake([]);
          touch();
        }}
      />
      <TileMultiPicker
        legend={t('tradeChooseGive', { name: player.name })}
        items={ownGive.map((view) => ({ view, caption: caption(view) }))}
        values={give}
        onToggle={(view) => toggleTile(give, setGive, view)}
      />
      <TileMultiPicker
        legend={t('tradeChooseTake', { name: counterparty?.name ?? t('selectedPlayer') })}
        items={theirs.map((view) => ({ view, caption: caption(view) }))}
        values={take}
        onToggle={(view) => toggleTile(take, setTake, view)}
      />
      <Toggle
        variant="inline"
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
      <Toggle
        variant="inline"
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
      <FieldHint>{t('tradeFeeHint')}</FieldHint>
      {short !== null && (
        <Notice tone="error">
          {t('tradeCannotAfford', {
            name: short.name,
            amount: money(Math.abs(short.id === player.id ? playerDelta : counterpartyDelta)),
          })}
        </Notice>
      )}
      <DialogActions>
        <Button variant="secondary" type="button" onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button variant="primary" disabled={!valid} onClick={() => setConfirming(true)}>
          {t('tradeReview')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
