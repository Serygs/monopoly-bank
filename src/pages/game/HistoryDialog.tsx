import type { Currency, Player, Transaction } from '../../../shared/types/monopoly';
import { Dialog } from '../../components/Dialog';
import { TransactionRow } from '../../components/game/TransactionRow';
import { Button, Notice, StatPill } from '../../components/ui';
import { apiErrorMessage } from '../../i18n/api-errors';
import { useLanguage } from '../../i18n/language-context';
import type { Language } from '../../i18n/translations';

export interface HistoryDialogProps {
  history: Transaction[] | null;
  player: Player | null;
  players: Player[];
  currency: Currency;
  error: unknown | null;
  language: Language;
  locale: string;
  onClose: () => void;
  onRetry: () => void;
}

export function HistoryDialog({
  history,
  player,
  players,
  currency,
  error,
  language,
  locale,
  onClose,
  onRetry,
}: HistoryDialogProps) {
  const { t } = useLanguage();
  const title = player === null ? t('gameHistory') : t('playerHistory', { name: player.name });
  return (
    <Dialog title={title} closeLabel={t('closeDialog', { title })} onClose={onClose}>
      {error !== null ? (
        <>
          <Notice tone="error">{apiErrorMessage(error, t, 'unableLoadHistory')}</Notice>
          <Button variant="secondary" onClick={onRetry}>
            {t('tryAgain')}
          </Button>
        </>
      ) : history === null ? (
        <StatPill variant="status" live>
          {t('loadingHistory')}
        </StatPill>
      ) : history.length === 0 ? (
        <p className="muted">{t('noTransactions')}</p>
      ) : (
        <ol className="history-list">
          {history.map((transaction) => (
            <TransactionRow
              key={transaction.id}
              variant="history"
              transaction={transaction}
              players={players}
              currency={currency}
              language={language}
              locale={locale}
              playerId={player?.id}
            />
          ))}
        </ol>
      )}
    </Dialog>
  );
}
