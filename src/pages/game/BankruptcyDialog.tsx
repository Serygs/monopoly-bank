import { useState } from 'react';
import type { BankLoanCooldown, Loan, Mortgage, Player } from '../../../shared/types/monopoly';
import { monopolyBankApi } from '../../api/monopoly-bank-api';
import { Dialog } from '../../components/Dialog';
import { Button, DialogActions, DialogBody, Notice } from '../../components/ui';
import { actionGridClass } from '../../components/ui/class-names';
import { apiErrorMessage } from '../../i18n/api-errors';
import { useLanguage } from '../../i18n/language-context';

export interface BankruptcyDialogProps {
  gameId: string;
  player: Player;
  players: Player[];
  /** The player has an active bank loan, which the bank collects first. */
  hasBankLoan?: boolean;
  onClose: () => void;
  /** The balances after the bankruptcy, and the mortgages and loans once they changed hands. */
  onCompleted: (
    players: Player[],
    mortgages?: Mortgage[],
    loans?: Loan[],
    bankLoanCooldowns?: BankLoanCooldown[],
    jackpot?: number,
  ) => void;
}

export function BankruptcyDialog({
  gameId,
  player,
  players,
  hasBankLoan = false,
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
      onCompleted(
        result.players,
        result.mortgages,
        result.loans,
        result.bankLoanCooldowns,
        result.jackpot,
      );
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
          {hasBankLoan && <Notice tone="info">{t('bankruptcyBankLoanHint')}</Notice>}
          <div className={actionGridClass}>
            <Button variant="secondary" onClick={() => setCreditorId(null)}>
              {t('toBank')}
            </Button>
            {players
              .filter((candidate) => candidate.id !== player.id && candidate.status !== 'BANKRUPT')
              .map((candidate) => (
                <Button
                  variant="secondary"
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
