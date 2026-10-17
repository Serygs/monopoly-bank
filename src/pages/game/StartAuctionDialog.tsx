import { useRef, useState } from 'react';
import type { AuctionResponse } from '../../../shared/contracts/api';
import type { BoardSnapshot } from '../../../shared/board';
import type { Currency, GameProperty, Player } from '../../../shared/types/monopoly';
import { normalizePropertyName } from '../../../shared/domain/mortgage';
import { monopolyBankApi } from '../../api/monopoly-bank-api';
import { Dialog } from '../../components/Dialog';
import { Button, SheetActions, DialogBody, Field, Notice } from '../../components/ui';
import { apiErrorMessage } from '../../i18n/api-errors';
import { useLanguage } from '../../i18n/language-context';
import { formatMoney } from '../../utils/money';
import { freeTiles, tileViews } from '../../utils/property-view';
import { TilePicker } from './TilePicker';

export interface StartAuctionDialogProps {
  gameId: string;
  /** The wallet that offers the property. */
  initiator: Player;
  /** Prefilled lot name, e.g. the note of a payment the player could not afford. */
  initialLotName?: string;
  /** Board games: the game's board; the lot is then an unowned tile chosen from a list. */
  board?: BoardSnapshot | null;
  properties?: readonly GameProperty[];
  currency?: Currency;
  /** The tile the quick entry started from. */
  initialTileId?: string;
  onClose: () => void;
  onStarted: (response: AuctionResponse) => void;
}

/** Asks for the property name and puts it up for auction on behalf of one wallet. */
export function StartAuctionDialog({
  gameId,
  initiator,
  initialLotName = '',
  board = null,
  properties = [],
  currency = 'UAH',
  initialTileId = '',
  onClose,
  onStarted,
}: StartAuctionDialogProps) {
  const { t } = useLanguage();
  const [lotName, setLotName] = useState(initialLotName.trim().slice(0, 60));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown | null>(null);
  const commandIdRef = useRef<string | null>(null);
  const submittingRef = useRef(false);
  const [tileId, setTileId] = useState(initialTileId);
  const tiles = board === null ? [] : freeTiles(tileViews(board, properties));
  const tile = tiles.find((view) => view.tile.id === tileId) ?? null;
  const normalized =
    board === null ? normalizePropertyName(lotName) : (tile?.tile.name.slice(0, 60) ?? null);
  const title = t('auctionStartTitle');

  const submit = async () => {
    if (submittingRef.current || normalized === null) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const commandId = commandIdRef.current ?? crypto.randomUUID();
      commandIdRef.current = commandId;
      onStarted(
        await monopolyBankApi.startAuction(
          gameId,
          {
            initiatorPlayerId: initiator.id,
            lotName: normalized,
            ...(board === null ? {} : { tileId }),
          },
          commandId,
        ),
      );
    } catch (caught) {
      setError(caught);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Dialog title={title} closeLabel={t('closeDialog', { title })} onClose={onClose} sheet="flow">
      <DialogBody>{t('auctionStartIntro')}</DialogBody>
      {error !== null && (
        <Notice tone="error">{apiErrorMessage(error, t, 'unableStartAuction')}</Notice>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {board === null ? (
          <Field variant="dialog" label={t('auctionLotName')}>
            <input
              value={lotName}
              maxLength={60}
              placeholder={t('auctionLotPlaceholder')}
              autoFocus
              onChange={(event) => {
                setLotName(event.target.value);
                setError(null);
                commandIdRef.current = null;
              }}
            />
          </Field>
        ) : (
          <TilePicker
            legend={t('tileChooseAuction')}
            items={tiles.map((view) => ({
              view,
              caption: t('tilePickerPrice', { amount: formatMoney(view.tile.price, currency) }),
            }))}
            value={tileId}
            onChange={(view) => {
              setTileId(view.tile.id);
              setError(null);
              commandIdRef.current = null;
            }}
          />
        )}
        <p className="mt-(--mb-space-2) text-small text-secondary">
          {t('auctionOfferedBy', { name: initiator.name })}
        </p>
        <SheetActions>
          <Button variant="secondary" type="button" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button variant="primary" type="submit" disabled={normalized === null || submitting}>
            {submitting ? t('auctionStarting') : t('auctionStart')}
          </Button>
        </SheetActions>
      </form>
    </Dialog>
  );
}
