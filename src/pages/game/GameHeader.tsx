import type { Game } from '../../../shared/types/monopoly';
import { OverflowMenu, type OverflowMenuItem } from '../../components/OverflowMenu';
import { PageHeader } from '../../components/PageHeader';
import { Button, MoneyValue, StatPill, Toolbar } from '../../components/ui';
import { cx } from '../../components/ui/class-names';
import { useLanguage } from '../../i18n/language-context';
import { gameStatusTranslationKey } from '../../utils/game-status';

export type LiveStatus = 'connecting' | 'reconnecting' | 'live' | 'offline';

/** Divider under the heading, the status chip in place of the eyebrow, and the action column. */
const headingClass = cx(
  'border-b border-border pb-(--mb-space-6) max-md:pb-(--mb-space-4) lg:items-end',
  '[&_.page-header-back]:mb-(--mb-space-4) [&_h1]:max-w-[24ch] [&_.lede]:mt-(--mb-space-4)',
  '[&_.eyebrow]:mb-(--mb-space-3) [&_.eyebrow]:inline-flex [&_.eyebrow]:w-fit [&_.eyebrow]:rounded-pill [&_.eyebrow]:border [&_.eyebrow]:border-border',
  '[&_.eyebrow]:bg-surface-subtle [&_.eyebrow]:px-(--mb-space-3) [&_.eyebrow]:py-(--mb-space-1) [&_.eyebrow]:tracking-[0] [&_.eyebrow]:text-secondary [&_.eyebrow]:normal-case',
  'max-md:[&_.page-header-actions]:block lg:[&_.page-header-actions]:self-end',
  // Compact: the bottom navigation owns Activity and Statistics; an empty action region is dropped.
  'max-md:[&_h1]:text-[1.75rem] max-md:[&_.page-header-back]:mb-(--mb-space-2) max-md:[&_.lede]:mt-(--mb-space-2)',
  'max-md:[&_.page-header-actions:not(:has(.button:not(.compact-hidden)))]:hidden',
);

/** Activity and Statistics live in the bottom navigation below `md`; manager actions move to a menu. */
const compactHiddenClass = 'compact-hidden max-md:hidden';

const passGoClass =
  'flex flex-wrap items-baseline gap-x-(--mb-space-2) gap-y-(--mb-space-1) [&>span]:text-secondary [&_strong]:font-money [&_strong]:whitespace-nowrap [&_strong]:text-primary [&_strong]:tabular-nums';

/** `!` outranks the Button primitive's own centring and inline padding. */
const backLinkClass = 'justify-start! px-0!';

const liveStatusClass = cx(
  'mt-(--mb-space-4) max-md:mt-(--mb-space-2) inline-flex min-h-[30px] w-fit items-center gap-(--mb-space-2) rounded-pill border px-(--mb-space-3) py-(--mb-space-1) text-small font-semibold',
  'before:size-[8px] before:flex-none before:rounded-[50%] before:bg-current',
);
const liveStatusToneClass: Record<LiveStatus, string> = {
  connecting: 'border-strong bg-surface-elevated text-secondary',
  reconnecting: 'border-strong bg-surface-elevated text-secondary',
  live: 'border-status-border bg-success-soft text-status-text',
  offline: 'border-danger-border bg-danger-soft text-danger',
};

export interface GameHeaderProps {
  game: Game;
  /** The Free Parking pot; shown only when the game has the jackpot rule. */
  jackpot?: number | undefined;
  canManage: boolean | undefined;
  liveStatus: LiveStatus;
  offline: boolean;
  onBack: () => void;
  onOpenActivity: () => void;
  onOpenStatistics: () => void;
  onInvite: () => void;
  onFinish: () => void;
}

/** Game page heading: status, name, Pass GO reward, toolbar and live-connection pill. */
export function GameHeader({
  game,
  jackpot,
  canManage,
  liveStatus,
  offline,
  onBack,
  onOpenActivity,
  onOpenStatistics,
  onInvite,
  onFinish,
}: GameHeaderProps) {
  const { t } = useLanguage();
  const managerItems: OverflowMenuItem[] = [];
  if (canManage && game.status === 'LOBBY')
    managerItems.push({ label: t('invitePlayers'), disabled: offline, onSelect: onInvite });
  if (canManage && game.status === 'ACTIVE')
    managerItems.push({
      label: t('finishGame'),
      tone: 'danger',
      disabled: offline,
      onSelect: onFinish,
    });
  return (
    <PageHeader
      className={cx(headingClass, game.status === 'ACTIVE' && 'max-md:[&_.eyebrow]:hidden')}
      eyebrow={t(gameStatusTranslationKey(game.status))}
      title={game.name}
      description={
        <span className={passGoClass}>
          <span>{t('passGoRewardLabel')}:</span>
          <strong>
            <MoneyValue amount={game.passGoReward} currency={game.currency} />
          </strong>
          {game.rules.freeParkingJackpot && game.status === 'ACTIVE' && (
            <>
              <span aria-hidden="true">·</span>
              <span>{t('freeParkingPotLabel')}:</span>
              <strong>
                <MoneyValue amount={jackpot ?? 0} currency={game.currency} />
              </strong>
            </>
          )}
        </span>
      }
      backAction={
        <div className="flex items-center justify-between gap-(--mb-space-3)">
          <Button variant="quiet" className={backLinkClass} onClick={onBack}>
            <span aria-hidden="true">←</span>
            {t('savedGames')}
          </Button>
          {managerItems.length > 0 && (
            <div className="md:hidden">
              <OverflowMenu label={t('gameActions', { name: game.name })} items={managerItems} />
            </div>
          )}
        </div>
      }
      actions={
        <Toolbar variant="game-page">
          <Button
            variant="secondary"
            className={compactHiddenClass}
            disabled={offline}
            onClick={onOpenActivity}
          >
            {t('activity')}
          </Button>
          <Button
            variant="secondary"
            className={compactHiddenClass}
            disabled={offline}
            onClick={onOpenStatistics}
          >
            {t('statistics')}
          </Button>
          {canManage && game.status === 'LOBBY' && (
            <Button
              variant="secondary"
              className={compactHiddenClass}
              disabled={offline}
              onClick={onInvite}
            >
              {t('invitePlayers')}
            </Button>
          )}
          {canManage && game.status === 'ACTIVE' && (
            <Button
              variant="danger"
              className={compactHiddenClass}
              disabled={offline}
              onClick={onFinish}
            >
              {t('finishGame')}
            </Button>
          )}
        </Toolbar>
      }
    >
      {game.status === 'ACTIVE' && (
        <StatPill live className={cx(liveStatusClass, liveStatusToneClass[liveStatus])}>
          {liveStatus === 'live'
            ? t('connectionLive')
            : liveStatus === 'connecting'
              ? t('connectionConnecting')
              : liveStatus === 'reconnecting'
                ? t('connectionReconnecting')
                : t('connectionOffline')}
        </StatPill>
      )}
    </PageHeader>
  );
}
