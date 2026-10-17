import type { DeletedGameSummary, GameSummary } from '../../../shared/contracts/api';
import { useLanguage } from '../../i18n/language-context';
import type { GameStatus } from '../../../shared/types/monopoly';
import { OverflowMenu } from '../OverflowMenu';
import { BankSeal, Button, Card, Toolbar } from '../ui';
import { cx } from '../ui/class-names';

/* The name column shrinks; these override the page's low-specificity `h2` typography. */
const copyClass = cx(
  'flex min-w-0 items-center gap-(--mb-space-4) [&>div]:min-w-0',
  '[&_h2]:mt-(--mb-space-1) [&_h2]:min-w-0 [&_h2]:truncate [&_h2]:text-[length:clamp(1.25rem,2vw,1.5rem)] [&_h2]:font-semibold',
);
const statusClass =
  'inline-flex min-h-6 w-fit items-center rounded-pill px-(--mb-space-2) py-[2px] text-meta font-semibold';
const statusToneClass: Record<GameStatus, string> = {
  LOBBY: 'bg-surface-subtle text-secondary',
  ACTIVE: 'bg-success-soft text-status-text',
  FINISHED: 'bg-surface-subtle text-muted',
};
const metaClass = cx(
  'mt-(--mb-space-2) flex flex-wrap gap-x-(--mb-space-3) gap-y-(--mb-space-1) text-small text-secondary',
  "[&>span+span]:before:me-(--mb-space-3) [&>span+span]:before:text-highlight [&>span+span]:before:content-['•']",
);

export interface GameCardProps {
  summary: GameSummary;
  /** Another saved game has the same name: the card adds its creation date and time. */
  sharesName?: boolean;
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
  sharesName = false,
  duplicating,
  onJoinGame,
  onOpenGame,
  onDuplicate,
  onRemove,
}: GameCardProps) {
  const { locale, t } = useLanguage();
  return (
    <Card as="article" variant="game">
      <div className={copyClass}>
        <BankSeal variant="card" />
        <div>
          <span className={cx(statusClass, statusToneClass[summary.game.status])}>
            {t(
              `gameStatus${summary.game.status[0]}${summary.game.status.slice(1).toLowerCase()}` as 'gameStatusLobby',
            )}
          </span>
          <h2 title={summary.game.name}>{summary.game.name}</h2>
          <div className={metaClass}>
            <span>{t('playersCount', { count: summary.playerCount })}</span>
            <span>{t('updated', { date: formatDate(summary.game.updatedAt, locale) })}</span>
            {sharesName && (
              <span>
                {t('gameCreated', { date: formatDate(summary.game.createdAt, locale, true) })}
              </span>
            )}
          </div>
        </div>
      </div>
      <Toolbar variant="game-card">
        {summary.isPublicLobby && summary.joinCode !== undefined ? (
          <Button variant="primary" onClick={() => onJoinGame(summary.joinCode)}>
            {t('joinOpenLobby')}
          </Button>
        ) : (
          <Button variant="primary" onClick={() => onOpenGame(summary.game.id)}>
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

export interface DeletedGameCardProps {
  summary: DeletedGameSummary;
  /** True while this game is being restored. */
  restoring: boolean;
  onRestore: () => void;
}

/** A removed game: shown as finished, with the last day it can be restored. */
export function DeletedGameCard({ summary, restoring, onRestore }: DeletedGameCardProps) {
  const { locale, t } = useLanguage();
  return (
    <Card as="article" variant="game">
      <div className={copyClass}>
        <BankSeal variant="card" />
        <div>
          <span className={cx(statusClass, statusToneClass.FINISHED)}>
            {t('gameStatusFinished')}
          </span>
          <h2 title={summary.game.name}>{summary.game.name}</h2>
          <div className={metaClass}>
            <span>{t('playersCount', { count: summary.playerCount })}</span>
            <span>
              {t('deletedRestorableUntil', { date: formatDate(summary.purgeAt, locale) })}
            </span>
          </div>
        </div>
      </div>
      <Toolbar variant="game-card">
        <Button variant="primary" disabled={restoring} onClick={onRestore}>
          {restoring ? t('restoring') : t('restoreGame')}
        </Button>
      </Toolbar>
    </Card>
  );
}

function formatDate(value: string, locale: string, withTime = false): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        ...(withTime ? { timeStyle: 'short', hourCycle: 'h23' as const } : {}),
      }).format(date);
}
