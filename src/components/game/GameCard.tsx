import type { GameSummary } from '../../../shared/contracts/api';
import { useLanguage } from '../../i18n/language-context';
import { OverflowMenu } from '../OverflowMenu';
import { Button, Card, Toolbar } from '../ui';

export interface GameCardProps {
  summary: GameSummary;
  /** True while this game is being duplicated. */
  duplicating: boolean;
  onJoinGame: (joinCode?: string) => void;
  onOpenGame: (gameId: string) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}

/** Saved-game card: status, name, meta line, primary action and overflow menu. */
export function GameCard({
  summary,
  duplicating,
  onJoinGame,
  onOpenGame,
  onDuplicate,
  onRemove,
}: GameCardProps) {
  const { locale, t } = useLanguage();
  return (
    <Card as="article" variant="game">
      <div className="game-card-copy">
        <span className="game-card-seal" aria-hidden="true">
          MB
        </span>
        <div className="game-card-details">
          <span
            className={`game-card-status game-card-status--${summary.game.status.toLowerCase()}`}
          >
            {t(
              `gameStatus${summary.game.status[0]}${summary.game.status.slice(1).toLowerCase()}` as 'gameStatusLobby',
            )}
          </span>
          <h2 title={summary.game.name}>{summary.game.name}</h2>
          <div className="game-card-meta">
            <span>{t('playersCount', { count: summary.playerCount })}</span>
            <span>{t('updated', { date: formatDate(summary.game.updatedAt, locale) })}</span>
          </div>
        </div>
      </div>
      <Toolbar variant="game-card">
        {summary.isPublicLobby && summary.joinCode !== undefined ? (
          <Button
            variant="primary"
            className="game-card-primary-action"
            onClick={() => onJoinGame(summary.joinCode)}
          >
            {t('joinOpenLobby')}
          </Button>
        ) : (
          <Button
            variant="primary"
            className="game-card-primary-action"
            onClick={() => onOpenGame(summary.game.id)}
          >
            {t('openGame')}
          </Button>
        )}
        <OverflowMenu
          label={t('gameActions', { name: summary.game.name })}
          items={[
            {
              label: duplicating ? t('duplicating') : t('duplicate'),
              disabled: duplicating,
              onSelect: onDuplicate,
            },
            {
              label: t('removeGame'),
              tone: 'danger',
              onSelect: onRemove,
            },
          ]}
        />
      </Toolbar>
    </Card>
  );
}

function formatDate(value: string, locale: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}
