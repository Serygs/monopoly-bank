import type { LedgerStatistics } from '../../shared/contracts/api';
import type { Currency, Player } from '../../shared/types/monopoly';
import { Dialog } from '../components/Dialog';
import { useLanguage } from '../i18n/language-context';
import { formatMoney } from '../utils/money';
export function StatisticsScreen({
  summary,
  currency,
  onClose,
}: {
  summary: { winners: Player[] } & LedgerStatistics;
  currency: Currency;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const leader = summary.cashLeaderboard[0]?.player;
  const duration = t('durationHoursMinutes', {
    hours: Math.floor(summary.durationMs / 3_600_000),
    minutes: Math.floor(summary.durationMs / 60_000) % 60,
  });
  return (
    <Dialog
      title={t('statistics')}
      closeLabel={t('closeDialog', { title: t('statistics') })}
      onClose={onClose}
      className="statistics-dialog"
    >
      <section className="statistics-report">
        <header>
          <div>
            <h3>
              {summary.winners.length === 0
                ? t('noWinner')
                : summary.winners.map((player) => player.name).join(', ')}
            </h3>
            <p>{t('winners')}</p>
          </div>
          {leader !== undefined && (
            <div className="cash-leader">
              <strong title={leader.name}>{leader.name}</strong>
              <span>
                {t('cashLeader')} · {formatMoney(leader.balance, currency)}
              </span>
            </div>
          )}
        </header>
        <dl className="statistics-grid">
          <Metric label={t('gameDuration')} value={duration} />
          <Metric label={t('transactionCount')} value={String(summary.totalTransactions)} />
          <Metric
            label={t('moneyMoved')}
            value={formatMoney(summary.totalMoneyTransferred, currency)}
          />
          <Metric
            label={t('largestTransaction')}
            value={formatMoney(summary.largestTransaction, currency)}
          />
        </dl>
        <section>
          <h3>{t('cashLeaderboard')}</h3>
          <ol className="cash-leaderboard">
            {summary.cashLeaderboard.map((entry) => (
              <li key={entry.player.id} style={{ borderInlineStartColor: entry.player.color }}>
                <strong title={entry.player.name}>{entry.player.name}</strong>
                <span>{formatMoney(entry.player.balance, currency)}</span>
                <small>
                  {t('sent')}: {formatMoney(entry.sent, currency)} · {t('received')}:{' '}
                  {formatMoney(entry.received, currency)} · {t('passGoCount')}: {entry.passGoCount}
                </small>
              </li>
            ))}
          </ol>
        </section>
      </section>
    </Dialog>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
