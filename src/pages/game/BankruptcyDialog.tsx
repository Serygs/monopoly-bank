import { useState } from 'react';
import type { Player } from '../../../shared/types/monopoly';
import { monopolyBankApi } from '../../api/monopoly-bank-api';
import { Dialog } from '../../components/Dialog';
import { Button, DialogActions, DialogBody, Notice } from '../../components/ui';
import { apiErrorMessage } from '../../i18n/api-errors';
import { useLanguage } from '../../i18n/language-context';

export interface BankruptcyDialogProps {
  gameId: string;
  player: Player;
  players: Player[];
  onClose: () => void;
  onCompleted: (players: Player[]) => void;
}

export function BankruptcyDialog({
  gameId,
  player,
  players,
  onClose,
  onCompleted,
}: BankruptcyDialogProps) {
  const { t } = useLanguage();
  const [creditorId, setCreditorId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const creditor = players.find((candidate) => candidate.id === creditorId) ?? null;
  const title = t('declareBankruptcyTitle', { name: player.name });
  const submit = async () => {
    try {
      const result = await monopolyBankApi.declareBankruptcy(gameId, {
        playerId: player.id,
        ...(creditorId === null ? {} : { creditorPlayerId: creditorId }),
      });
      onCompleted(result.players);
    } catch (caught) {
      setError(apiErrorMessage(caught, t, 'unableRecordTransaction'));
    }
  };
  return (
    <Dialog title={title} closeLabel={t('closeDialog', { title })} onClose={onClose}>
      {confirming ? (
        <>
          <DialogBody>
            {creditor === null
              ? t('bankruptcyToBank')
              : t('bankruptcyToPlayer', { name: player.name, creditor: creditor.name })}{' '}
            {t('bankruptcyIrreversible')}
          </DialogBody>
          {error !== null && <Notice tone="error">{error}</Notice>}
          <DialogActions>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              {t('back')}
            </Button>
            <Button variant="danger" onClick={() => void submit()}>
              {t('confirmBankruptcy')}
            </Button>
          </DialogActions>
        </>
      ) : (
        <>
          <DialogBody>{t('chooseBankruptcyDestination', { name: player.name })}</DialogBody>
          <div className="action-grid">
            <Button
              variant="secondary"
              className={creditorId === null ? 'selected' : undefined}
              onClick={() => setCreditorId(null)}
            >
              {t('toBank')}
            </Button>
            {players
              .filter((candidate) => candidate.id !== player.id && candidate.status !== 'BANKRUPT')
              .map((candidate) => (
                <Button
                  variant="secondary"
                  className={creditorId === candidate.id ? 'selected' : undefined}
                  key={candidate.id}
                  onClick={() => setCreditorId(candidate.id)}
                >
                  {t('toPlayer', { name: candidate.name })}
                </Button>
              ))}
          </div>
          <DialogActions>
            <Button variant="secondary" onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button variant="danger" onClick={() => setConfirming(true)}>
              {t('reviewBankruptcy')}
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
