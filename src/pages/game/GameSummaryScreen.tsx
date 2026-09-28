import type { FinalGameSummary } from '../../../shared/domain/game-summary';
import type { Currency, Game, Player } from '../../../shared/types/monopoly';
import { Button, Card } from '../../components/ui';
import { useLanguage } from '../../i18n/language-context';
import { formatMoney } from '../../utils/money';
import { cx, eyebrowClass } from '../../components/ui/class-names';

export interface GameSummaryScreenProps {
  summary: { game: Game; winners: Player[] } & FinalGameSummary;
  players: Player[];
  currency: Currency;
  onClose: () => void;
}

/*
 * Heading row, the metric and extreme tiles (`> dl`), and one tile per player result (`li`, with a
 * colour bar from the inline `borderInlineStartColor`). Stacked heading and one-column results
 * below `md`.
 */
const summaryClass = cx(
  'w-full p-[clamp(20px,5vw,34px)]',
  '[&>header]:flex [&>header]:items-start [&>header]:justify-between [&>header]:gap-[16px] max-md:[&>header]:flex-col max-md:[&>header_.button]:w-full',
  '[&>dl]:grid [&>dl]:grid-cols-[repeat(auto-fit,minmax(150px,1fr))] [&>dl]:gap-[10px] [&>dl:first-of-type]:mx-0 [&>dl:first-of-type]:mt-[22px] [&>dl:first-of-type]:mb-[10px]',
  '[&>dl>div]:rounded-[12px] [&>dl>div]:border [&>dl>div]:border-border [&>dl>div]:bg-surface-elevated [&>dl>div]:p-[14px]',
  '[&_dt]:text-[0.82rem] [&_dt]:text-secondary',
  '[&>dl_dd]:mx-0 [&>dl_dd]:mt-[6px] [&>dl_dd]:mb-0 [&>dl_dd]:text-[1.2rem] [&>dl_dd]:font-bold [&>dl_dd]:text-primary',
  '[&_ol]:mx-0 [&_ol]:mt-[12px] [&_ol]:mb-0 [&_ol]:grid [&_ol]:list-none [&_ol]:gap-[10px] [&_ol]:p-0',
  '[&_li]:rounded-[12px] [&_li]:border [&_li]:border-s-[5px] [&_li]:border-border [&_li]:bg-surface-elevated [&_li]:p-[14px]',
  '[&_li>div]:flex [&_li>div]:justify-between [&_li>div_span]:text-[0.86rem] [&_li>div_span]:font-semibold [&_li>div_span]:text-accent',
  '[&_li_dl]:mx-0 [&_li_dl]:mt-[14px] [&_li_dl]:mb-0 [&_li_dl]:grid [&_li_dl]:grid-cols-3 [&_li_dl]:gap-[10px] max-md:[&_li_dl]:grid-cols-1',
  '[&_li_dd]:mx-0 [&_li_dd]:mt-[4px] [&_li_dd]:mb-0 [&_li_dd]:font-bold [&_li_dd]:text-primary',
);

export function GameSummaryScreen({ summary, players, currency, onClose }: GameSummaryScreenProps) {
  const { t } = useLanguage();
  const winnerIds = new Set(summary.winners.map((player) => player.id));
  const metrics = new Map(summary.players.map((metric) => [metric.playerId, metric]));
  const nameFor = (id: string | null) =>
    id === null
      ? t('notDecided')
      : (players.find((player) => player.id === id)?.name ?? t('notDecided'));
  const cards = [
    [t('totalTransferred'), summary.totalMoneyTransferred],
    [t('playerToPlayerTransferred'), summary.playerToPlayerTotal],
    [t('paidToBank'), summary.paidToBank],
    [t('summaryReceivedFromBank'), summary.receivedFromBank],
    [t('largestTransaction'), summary.largestTransaction],
  ] as const;
  return (
    <Card variant="banknote" className={summaryClass}>
      <header>
        <div>
          <p className={eyebrowClass}>{t('finalSummary')}</p>
          <h2>{summary.game.name}</h2>
          <p>
            <strong>{t('winners')}:</strong>{' '}
            {summary.winners.length === 0
              ? t('notDecided')
              : summary.winners.map((player) => player.name).join(', ')}
          </p>
        </div>
        <Button variant="quiet" onClick={onClose}>
          {t('close')}
        </Button>
      </header>
      <dl>
        {cards.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{formatMoney(value, currency)}</dd>
          </div>
        ))}
      </dl>
      <dl>
        <div>
          <dt>{t('highestSender')}</dt>
          <dd>{nameFor(summary.biggestSenderId)}</dd>
        </div>
        <div>
          <dt>{t('lowestSender')}</dt>
          <dd>{nameFor(summary.leastSenderId)}</dd>
        </div>
      </dl>
      <section>
        <h3>{t('playerResults')}</h3>
        <ol>
          {players.map((player) => {
            const metric = metrics.get(player.id);
            const outcome =
              player.status === 'BANKRUPT'
                ? t('bankrupt')
                : winnerIds.has(player.id)
                  ? t('winner')
                  : t('lost');
            return (
              <li key={player.id} style={{ borderInlineStartColor: player.color }}>
                <div>
                  <strong>{player.name}</strong>
                  <span>{outcome}</span>
                </div>
                <dl>
                  <div>
                    <dt>{t('finalBalance')}</dt>
                    <dd>{formatMoney(player.balance, currency)}</dd>
                  </div>
                  <div>
                    <dt>{t('sent')}</dt>
                    <dd>{formatMoney(metric?.sent ?? 0, currency)}</dd>
                  </div>
                  <div>
                    <dt>{t('received')}</dt>
                    <dd>{formatMoney(metric?.received ?? 0, currency)}</dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </ol>
      </section>
    </Card>
  );
}
