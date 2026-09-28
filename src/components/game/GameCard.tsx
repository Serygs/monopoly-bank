import type { GameSummary } from '../../../shared/contracts/api';
import { useLanguage } from '../../i18n/language-context';
import type { GameStatus } from '../../../shared/types/monopoly';
import { OverflowMenu } from '../OverflowMenu';
import { Button, Card, Toolbar } from '../ui';
import { cx } from '../ui/class-names';

/* The name column shrinks; these override the page's low-specificity `h2` typography. */
const copyClass = cx(
  'flex min-w-0 items-center gap-(--mb-space-4) [&>div]:min-w-0',
  '[&_h2]:mt-(--mb-space-1) [&_h2]:min-w-0 [&_h2]:truncate [&_h2]:text-[length:clamp(1.25rem,2vw,1.5rem)] [&_h2]:font-semibold',
);
/* Classic Bank shows the hero artwork in the seal, cropped differently on every 2nd and 3rd card. */
const sealClass = cx(
  'grid h-[82px] w-[74px] flex-none place-items-center overflow-hidden rounded-[calc(var(--mb-radius-card)_-_4px)]',
  'border border-[color:color-mix(in_srgb,var(--mb-color-highlight)_64%,transparent)] bg-surface-inverse-elevated bg-cover bg-center',
  'text-meta font-bold tracking-meta text-on-inverse shadow-[inset_0_0_0_2px_color-mix(in_srgb,var(--mb-color-surface-inverse)_70%,transparent)]',
  'classic:border-[rgb(197_163_77/0.5)] classic:text-transparent classic:shadow-[inset_0_0_0_1px_rgb(255_249_234/0.22)]',
  'classic:bg-[image:linear-gradient(rgb(7_56_45/0.12),rgb(7_56_45/0.18)),url(/assets/themes/classic/hero-bank.webp)]',
  'classic:[.game-card:nth-child(2n):not(:nth-child(3n))_&]:bg-[position:75%_center] classic:[.game-card:nth-child(3n)_&]:bg-[position:88%_62%]',
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
      <div className={copyClass}>
        <span className={sealClass} aria-hidden="true">
          MB
        </span>
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

function formatDate(value: string, locale: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}
