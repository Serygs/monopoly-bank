import type { LedgerStatistics } from '../../shared/contracts/api';
import type { Currency, Player } from '../../shared/types/monopoly';
import { Dialog } from '../components/Dialog';
import { MoneyValue } from '../components/ui';
import { useLanguage } from '../i18n/language-context';
import { cx, wideDialogClass } from '../components/ui/class-names';
import { formatMoney } from '../utils/money';

/*
 * `statistics-report` stays as the e2e hook. Liquid Glass frosts the metric tiles and the
 * leaderboard rows.
 */
const reportClass = 'statistics-report [&_h3]:m-0 [&_h3]:text-primary';
const reportHeaderClass = cx(
  'flex items-end justify-between gap-[18px] border-b-2 border-accent pb-[20px] max-md:flex-col max-md:items-start',
  'glass:border-[color:color-mix(in_srgb,var(--mb-color-accent)_48%,transparent)]',
  '[&_p]:mx-0 [&_p]:mt-[4px] [&_p]:mb-0 [&_p]:text-secondary',
);
const leaderClass = cx(
  'grid min-w-0 justify-items-end text-end max-md:justify-items-start max-md:text-start',
  '[&_strong]:max-w-full [&_strong]:truncate [&_strong]:text-[1.25rem] [&_strong]:text-primary',
  '[&_span]:text-[0.84rem] [&_span]:text-secondary',
);
const gridClass = cx(
  'mx-0 my-[20px] grid grid-cols-2 gap-(--mb-space-2) max-md:grid-cols-[1fr]',
  '*:rounded-md *:border *:border-border *:bg-surface-subtle *:p-[14px]',
  'glass:*:border-[rgb(85_98_116/0.16)] glass:*:bg-[rgb(255_255_255/0.54)] glass:*:shadow-[inset_0_1px_0_rgb(255_255_255/0.68)]',
  'glass:dark:*:border-[rgb(255_255_255/0.14)] glass:dark:*:bg-[rgb(50_61_76/0.68)] glass:dark:*:shadow-[inset_0_1px_0_rgb(255_255_255/0.1)]',
  '[&_dt]:text-[0.8rem] [&_dt]:text-secondary',
  '[&_dd]:mx-0 [&_dd]:mt-[6px] [&_dd]:mb-0 [&_dd]:font-money [&_dd]:text-[1.2rem] [&_dd]:font-bold [&_dd]:text-primary [&_dd]:tabular-nums [&_dd]:wrap-anywhere',
);
/* The row's inline-start border takes the player colour from the inline style. */
const leaderboardClass = cx(
  'm-0 grid list-none gap-0 p-0',
  'glass:[&>li]:border-[rgb(85_98_116/0.16)] glass:[&>li]:bg-[rgb(255_255_255/0.54)] glass:[&>li]:shadow-[inset_0_1px_0_rgb(255_255_255/0.68)]',
  'glass:dark:[&>li]:border-[rgb(255_255_255/0.14)] glass:dark:[&>li]:bg-[rgb(50_61_76/0.68)] glass:dark:[&>li]:shadow-[inset_0_1px_0_rgb(255_255_255/0.1)]',
  '[&>li]:mt-2 [&>li]:grid [&>li]:grid-cols-[minmax(0,1fr)_auto] [&>li]:gap-x-3 [&>li]:gap-y-1 [&>li]:rounded-[10px] [&>li]:border [&>li]:border-s-[5px] [&>li]:border-border [&>li]:p-3',
  '[&_li>strong]:min-w-0 [&_li>strong]:truncate',
  '[&_li>span]:shrink-0 [&_li>span]:font-money [&_li>span]:whitespace-nowrap [&_li>span]:tabular-nums',
  '[&_small]:col-span-full [&_small]:text-[0.84rem] [&_small]:text-secondary',
);
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
      className={wideDialogClass}
    >
      <section className={reportClass}>
        <header className={reportHeaderClass}>
          <div>
            <h3>
              {summary.winners.length === 0
                ? t('noWinner')
                : summary.winners.map((player) => player.name).join(', ')}
            </h3>
            <p>{t('winners')}</p>
          </div>
          {leader !== undefined && (
            <div className={leaderClass}>
              <strong title={leader.name}>{leader.name}</strong>
              <span>
                {t('cashLeader')} · <MoneyValue amount={leader.balance} currency={currency} />
              </span>
            </div>
          )}
        </header>
        <dl className={gridClass}>
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
          <ol className={leaderboardClass}>
            {summary.cashLeaderboard.map((entry) => (
              <li key={entry.player.id} style={{ borderInlineStartColor: entry.player.color }}>
                <strong title={entry.player.name}>{entry.player.name}</strong>
                <span>
                  <MoneyValue amount={entry.player.balance} currency={currency} />
                </span>
                <small>
                  {t('sent')}: <MoneyValue amount={entry.sent} currency={currency} /> ·{' '}
                  {t('received')}: <MoneyValue amount={entry.received} currency={currency} /> ·{' '}
                  {t('passGoCount')}: {entry.passGoCount}
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
