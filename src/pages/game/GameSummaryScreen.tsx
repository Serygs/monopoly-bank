import type { FinalGameSummary } from '../../../shared/domain/game-summary';
import type { Currency, Game, Player } from '../../../shared/types/monopoly';
import { Button, Card } from '../../components/ui';
import { useLanguage } from '../../i18n/language-context';
import { formatMoney } from '../../utils/money';

export interface GameSummaryScreenProps {
  summary: { game: Game; winners: Player[] } & FinalGameSummary;
  players: Player[];
  currency: Currency;
  onClose: () => void;
}

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
    <Card variant="banknote" className="summary-screen">
      <header className="summary-heading">
        <div>
          <p className="eyebrow">{t('finalSummary')}</p>
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
      <dl className="summary-metrics">
        {cards.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{formatMoney(value, currency)}</dd>
          </div>
        ))}
      </dl>
      <dl className="summary-extremes">
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
        <ol className="summary-player-results">
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
