import type { Game } from '../../../shared/types/monopoly';
import type { RefreshControl } from '../../hooks/useGameSync';
import { OverflowMenu, type OverflowMenuItem } from '../../components/OverflowMenu';
import { PageHeader } from '../../components/PageHeader';
import { RefreshIcon } from '../../components/RefreshIcon';
import { Button, MoneyValue, StatPill, Toolbar } from '../../components/ui';
import { cx } from '../../components/ui/class-names';
import { useLanguage } from '../../i18n/language-context';
import { gameStatusTranslationKey } from '../../utils/game-status';

export type LiveStatus = 'connecting' | 'reconnecting' | 'live' | 'offline';

/** Divider under the heading, the status chip in place of the eyebrow, and the action column. */
const headingClass = cx(
  'border-b border-border pb-(--mb-space-6) max-md:pb-(--mb-space-3) max-md:mb-(--mb-space-3) lg:items-end',
  '[&_.page-header-back]:mb-(--mb-space-4) [&_h1]:max-w-[24ch] [&_.lede]:mt-(--mb-space-4)',
  '[&_.eyebrow]:mb-(--mb-space-3) [&_.eyebrow]:inline-flex [&_.eyebrow]:w-fit [&_.eyebrow]:rounded-pill [&_.eyebrow]:border [&_.eyebrow]:border-border',
  '[&_.eyebrow]:bg-surface-subtle [&_.eyebrow]:px-(--mb-space-3) [&_.eyebrow]:py-(--mb-space-1) [&_.eyebrow]:tracking-[0] [&_.eyebrow]:text-secondary [&_.eyebrow]:normal-case',
  'max-md:[&_.page-header-actions]:block lg:[&_.page-header-actions]:self-end',
  // Compact: the bottom navigation owns Activity and Statistics; an empty action region is dropped.
  'max-md:[&_h1]:text-[1.5rem] max-md:[&_h1]:leading-[1.15] max-md:[&_.page-header-back]:mb-(--mb-space-1) max-md:[&_.lede]:mt-(--mb-space-1)',
  'max-md:[&_.page-header-actions:not(:has(.button:not(.compact-hidden)))]:hidden',
);

/** Activity and Statistics live in the bottom navigation below `md`; manager actions move to a menu. */
const compactHiddenClass = 'compact-hidden max-md:hidden';

const passGoClass =
  'flex flex-wrap items-center gap-x-(--mb-space-2) gap-y-(--mb-space-1) [&>span]:text-secondary [&_strong]:font-money [&_strong]:whitespace-nowrap [&_strong]:text-primary [&_strong]:tabular-nums';

/** `!` outranks the Button primitive's own centring and inline padding. */
const backLinkClass = 'justify-start! px-0!';

const liveStatusClass =
  'inline-flex min-h-[24px] items-center gap-(--mb-space-2) text-small font-semibold before:size-[8px] before:flex-none before:rounded-[50%] before:bg-current';
const liveStatusToneClass: Record<LiveStatus, string> = {
  connecting: 'text-secondary',
  reconnecting: 'text-secondary',
  live: 'text-status-text',
  offline: 'text-danger',
};

const refreshButtonClass = 'size-[44px] min-h-[44px] min-w-[44px] p-0';
const refreshToneClass: Record<RefreshControl['state'], string> = {
  idle: 'text-secondary',
  busy: 'text-secondary',
  done: 'text-status-text',
  error: 'text-danger',
};

function RefreshButton({ refresh, offline }: { refresh: RefreshControl; offline: boolean }) {
  const { t } = useLanguage();
  const message =
    refresh.state === 'done'
      ? t('refreshGameDone')
      : refresh.state === 'error'
        ? t('refreshGameFailed')
        : '';
  return (
    <span className="relative inline-flex">
      <span
        role="status"
        className={
          message === ''
            ? 'sr-only'
            : cx(
                'absolute right-0 top-full z-10 mt-1 whitespace-nowrap rounded-md bg-surface-elevated px-2 py-1 text-small shadow-sm',
                refreshToneClass[refresh.state],
              )
        }
      >
        {message}
      </span>
      <Button
        variant="quiet"
        iconOnly
        className={cx(refreshButtonClass, refreshToneClass[refresh.state])}
        aria-label={t('refreshGame')}
        aria-busy={refresh.state === 'busy'}
        disabled={offline || refresh.state === 'busy'}
        onClick={refresh.run}
      >
        <RefreshIcon state={refresh.state} />
      </Button>
    </span>
  );
}

export interface GameHeaderProps {
  game: Game;
  /** The Free Parking pot; shown only when the game has the jackpot rule. */
  jackpot?: number | undefined;
  canManage: boolean | undefined;
  liveStatus: LiveStatus;
  refresh: RefreshControl;
  offline: boolean;
  onBack: () => void;
  onOpenActivity: () => void;
  onOpenStatistics: () => void;
  onOpenRules: () => void;
  onInvite: () => void;
  onFinish: () => void;
}

/** Game page heading: status, name, Pass GO reward, toolbar and live-connection pill. */
export function GameHeader({
  game,
  jackpot,
  canManage,
  liveStatus,
  refresh,
  offline,
  onBack,
  onOpenActivity,
  onOpenStatistics,
  onOpenRules,
  onInvite,
  onFinish,
}: GameHeaderProps) {
  const { t } = useLanguage();
  // Rules read offline, so they stay available whatever the connection.
  const managerItems: OverflowMenuItem[] = [{ label: t('gameRules'), onSelect: onOpenRules }];
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
          <div className="flex items-center gap-(--mb-space-2)">
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
            {game.status !== 'FINISHED' && <RefreshButton refresh={refresh} offline={offline} />}
            {managerItems.length > 0 && (
              <div className="md:hidden">
                <OverflowMenu label={t('gameActions', { name: game.name })} items={managerItems} />
              </div>
            )}
          </div>
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
          <Button variant="secondary" className={compactHiddenClass} onClick={onOpenRules}>
            {t('gameRules')}
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
    ></PageHeader>
  );
}
