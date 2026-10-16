import { useRef, useState } from 'react';
import type { AuctionResponse } from '../../../shared/contracts/api';
import type { Player } from '../../../shared/types/monopoly';
import { normalizePropertyName } from '../../../shared/domain/mortgage';
import { monopolyBankApi } from '../../api/monopoly-bank-api';
import { Dialog } from '../../components/Dialog';
import { Button, DialogActions, DialogBody, Field, Notice } from '../../components/ui';
import { apiErrorMessage } from '../../i18n/api-errors';
import { useLanguage } from '../../i18n/language-context';

export interface StartAuctionDialogProps {
  gameId: string;
  /** The wallet that offers the property. */
  initiator: Player;
  /** Prefilled lot name, e.g. the note of a payment the player could not afford. */
  initialLotName?: string;
  onClose: () => void;
  onStarted: (response: AuctionResponse) => void;
}

/** Asks for the property name and puts it up for auction on behalf of one wallet. */
export function StartAuctionDialog({
  gameId,
  initiator,
  initialLotName = '',
  onClose,
  onStarted,
}: StartAuctionDialogProps) {
  const { t } = useLanguage();
  const [lotName, setLotName] = useState(initialLotName.trim().slice(0, 60));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown | null>(null);
  const commandIdRef = useRef<string | null>(null);
  const submittingRef = useRef(false);
  const normalized = normalizePropertyName(lotName);
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
          { initiatorPlayerId: initiator.id, lotName: normalized },
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
    <Dialog title={title} closeLabel={t('closeDialog', { title })} onClose={onClose}>
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
        <p className="mt-(--mb-space-2) text-small text-secondary">
          {t('auctionOfferedBy', { name: initiator.name })}
        </p>
        <DialogActions>
          <Button variant="secondary" type="button" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button variant="primary" type="submit" disabled={normalized === null || submitting}>
            {submitting ? t('auctionStarting') : t('auctionStart')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
