import type { ReactNode } from 'react';
import { useLanguage } from '../../i18n/language-context';
import { cx } from '../ui/class-names';

export type GameView = 'wallets' | 'tools';

export interface GameBottomNavProps {
  view: GameView;
  pendingRequests: number;
  payDisabled: boolean;
  activityDisabled: boolean;
  toolsDisabled: boolean;
  onSelectView: (view: GameView) => void;
  onPay: () => void;
  onOpenActivity: () => void;
  onOpenStatistics: () => void;
}

/*
 * Compact-only navigation (`md:hidden`): the bar sits above the home indicator and the raised Pay
 * action overlaps it by 12px. `game-bottom-nav` stays as the hook for the e2e checks.
 */
const navClass = cx(
  'game-bottom-nav fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface-elevated md:hidden',
  'pb-[max(var(--mb-space-2),var(--mb-app-safe-bottom))] shadow-lg',
  'glass:border-[rgb(85_98_116/0.14)] glass:bg-[rgb(255_255_255/0.72)] glass:backdrop-blur-[22px] glass:backdrop-saturate-[1.35]',
  'glass:dark:border-[rgb(255_255_255/0.14)] glass:dark:bg-[rgb(40_49_62/0.78)]',
);
const listClass =
  'mx-auto m-0 grid w-[min(100%,var(--mb-layout-content-max))] list-none grid-cols-5 items-end p-0 px-(--mb-space-2)';
const itemClass = cx(
  'relative flex min-h-[56px] w-full min-w-0 cursor-pointer flex-col items-center justify-center gap-[2px] rounded-control border-0 bg-transparent px-[2px] py-(--mb-space-1)',
  'font-ui text-[0.6875rem] leading-[1.15] font-semibold text-secondary',
  'focus-visible:outline-offset-[-2px] disabled:cursor-not-allowed disabled:opacity-60',
  'aria-[current=page]:text-highlight',
);
const labelClass = 'max-w-full truncate';
const payButtonClass = cx(
  'relative -mt-[12px] flex size-[56px] cursor-pointer flex-col items-center justify-center rounded-[50%] border-0',
  'bg-surface-inverse text-on-inverse shadow-md focus-visible:outline-offset-3',
  'disabled:cursor-not-allowed disabled:opacity-60 enabled:active:transform-[translateY(1px)]',
);
const badgeClass =
  'absolute -top-[2px] left-[calc(50%+4px)] grid min-h-[18px] min-w-[18px] place-items-center rounded-pill bg-danger px-[5px] text-[0.6875rem] leading-none font-bold text-on-danger';

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Wallets, Pay, Activity, Statistics and Tools for the compact game screen. */
export function GameBottomNav({
  view,
  pendingRequests,
  payDisabled,
  activityDisabled,
  toolsDisabled,
  onSelectView,
  onPay,
  onOpenActivity,
  onOpenStatistics,
}: GameBottomNavProps) {
  const { t } = useLanguage();
  return (
    <nav className={navClass} aria-label={t('gameNavigation')}>
      <ul className={listClass}>
        <li className="grid">
          <button
            type="button"
            className={itemClass}
            aria-current={view === 'wallets' ? 'page' : undefined}
            onClick={() => onSelectView('wallets')}
          >
            <Icon>
              <rect x="3" y="6" width="18" height="13" rx="3" />
              <path d="M16 12.5h2.5M3 10h18" />
            </Icon>
            <span className={labelClass}>{t('navWallets')}</span>
            {pendingRequests > 0 && (
              <span
                className={badgeClass}
                role="status"
                aria-label={t('navPendingRequests', { count: pendingRequests })}
              >
                {pendingRequests}
              </span>
            )}
          </button>
        </li>
        <li className="grid justify-items-center">
          <button type="button" className={payButtonClass} disabled={payDisabled} onClick={onPay}>
            <Icon>
              <path d="M7 8h12l-3-3M17 16H5l3 3" />
            </Icon>
            <span className="sr-only">{t('navPay')}</span>
          </button>
          <span
            aria-hidden="true"
            className="text-[0.6875rem] leading-[1.15] font-semibold text-secondary"
          >
            {t('navPay')}
          </span>
        </li>
        <li className="grid">
          <button
            type="button"
            className={itemClass}
            disabled={activityDisabled}
            onClick={onOpenActivity}
          >
            <Icon>
              <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
            </Icon>
            <span className={labelClass}>{t('activity')}</span>
          </button>
        </li>
        <li className="grid">
          <button
            type="button"
            className={itemClass}
            disabled={activityDisabled}
            onClick={onOpenStatistics}
          >
            <Icon>
              <path d="M5 20V10M12 20V4M19 20v-7" />
            </Icon>
            <span className={labelClass}>{t('statistics')}</span>
          </button>
        </li>
        <li className="grid">
          <button
            type="button"
            className={itemClass}
            disabled={toolsDisabled}
            aria-current={view === 'tools' ? 'page' : undefined}
            onClick={() => onSelectView('tools')}
          >
            <Icon>
              <path d="M14.5 6.5a4 4 0 0 0-5 5L4 17l3 3 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2-.5-.5-2z" />
            </Icon>
            <span className={labelClass}>{t('navTools')}</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
