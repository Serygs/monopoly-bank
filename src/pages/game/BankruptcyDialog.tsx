import { useState } from 'react';
import type { BoardSnapshot } from '../../../shared/board';
import { bankruptcyPreview } from '../../../shared/domain/banking';
import type {
  BankLoanCooldown,
  Currency,
  GameProperty,
  Loan,
  Mortgage,
  Player,
} from '../../../shared/types/monopoly';
import { MonopolyBankApiError, monopolyBankApi } from '../../api/monopoly-bank-api';
import { Dialog } from '../../components/Dialog';
import { Button, SheetActions, DialogBody, Notice } from '../../components/ui';
import { actionGridClass } from '../../components/ui/class-names';
import { apiErrorMessage } from '../../i18n/api-errors';
import { useLanguage } from '../../i18n/language-context';
import { formatMoney } from '../../utils/money';

export interface BankruptcyDialogProps {
  gameId: string;
  player: Player;
  players: Player[];
  /** The player has an active bank loan, which the bank collects first. */
  hasBankLoan?: boolean;
  /** Board games: the registry, to show what passes on and what the creditor owes. */
  board?: BoardSnapshot | null;
  properties?: readonly GameProperty[];
  currency?: Currency;
  /** Opens a wallet, so a creditor who cannot pay the fees can mortgage or sell first. */
  onOpenWallet?: (player: Player) => void;
  onClose: () => void;
  /** The balances after the bankruptcy, and the mortgages and loans once they changed hands. */
  onCompleted: (
    players: Player[],
    mortgages?: Mortgage[],
    loans?: Loan[],
    bankLoanCooldowns?: BankLoanCooldown[],
    jackpot?: number,
    changedProperties?: GameProperty[],
  ) => void;
}

export function BankruptcyDialog({
  gameId,
  player,
  players,
  hasBankLoan = false,
  board = null,
  properties = [],
  currency = 'UAH',
  onOpenWallet,
  onClose,
  onCompleted,
}: BankruptcyDialogProps) {
  const { t } = useLanguage();
  const [creditorId, setCreditorId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<unknown | null>(null);
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
        result.properties,
      );
    } catch (caught) {
      setError(caught);
    }
  };
  const money = (value: number) => formatMoney(value, currency);
  // What the bankruptcy does to the board: tiles pass on, buildings are sold back at half price.
  const { tileCount, buildings, proceeds, creditorFee } = bankruptcyPreview(
    board === null ? undefined : { board, registry: properties },
    player.id,
    creditor !== null,
  );
  const shortError =
    error instanceof MonopolyBankApiError && error.code === 'BANKRUPTCY_CREDITOR_SHORT'
      ? error
      : null;
  const shortfall =
    typeof shortError?.details?.shortfall === 'number' ? shortError.details.shortfall : 0;
  return (
    <Dialog title={title} closeLabel={t('closeDialog', { title })} onClose={onClose} sheet="flow">
      {confirming ? (
        <>
          <DialogBody>
            {creditor === null
              ? t('bankruptcyToBank')
              : t('bankruptcyToPlayer', { name: player.name, creditor: creditor.name })}{' '}
            {t('bankruptcyIrreversible')}
          </DialogBody>
          {board !== null && tileCount > 0 && (
            <Notice tone="info">
              <p>
                {creditor === null
                  ? t('bankruptcyTilesToBank', { count: tileCount })
                  : t('bankruptcyTilesToPlayer', { count: tileCount, creditor: creditor.name })}
              </p>
              {buildings > 0 && (
                <p>
                  {t('bankruptcyBuildingsSold', {
                    count: buildings,
                    amount: money(proceeds),
                  })}
                </p>
              )}
              {creditorFee > 0 && creditor !== null && (
                <p>
                  {t('bankruptcyCreditorFee', {
                    creditor: creditor.name,
                    amount: money(creditorFee),
                  })}
                </p>
              )}
            </Notice>
          )}
          {shortError !== null && creditor !== null ? (
            <Notice tone="error">
              <p>
                {t('bankruptcyCreditorShort', {
                  creditor: creditor.name,
                  amount: money(shortfall),
                })}
              </p>
              {onOpenWallet !== undefined && (
                <Button variant="secondary" onClick={() => onOpenWallet(creditor)}>
                  {t('bankruptcyOpenWallet', { name: creditor.name })}
                </Button>
              )}
            </Notice>
          ) : (
            error !== null && (
              <Notice tone="error">{apiErrorMessage(error, t, 'unableRecordTransaction')}</Notice>
            )
          )}
          <SheetActions>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              {t('back')}
            </Button>
            <Button variant="danger" onClick={() => void submit()}>
              {t('confirmBankruptcy')}
            </Button>
          </SheetActions>
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
          <SheetActions>
            <Button variant="secondary" onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button variant="danger" onClick={() => setConfirming(true)}>
              {t('reviewBankruptcy')}
            </Button>
          </SheetActions>
        </>
      )}
    </Dialog>
  );
}
