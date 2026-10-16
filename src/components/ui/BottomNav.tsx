import type { ReactNode } from 'react';
import { cx } from './class-names';

export interface BottomNavItem {
  key: string;
  label: string;
  icon: ReactNode;
  onPress: () => void;
  /** The destination whose screen or sheet is open: highlighted and `aria-current`. */
  active?: boolean;
  disabled?: boolean;
  /** A count shown on the item, with its accessible name. */
  badge?: { count: number; label: string };
  /** The one prominent circular action (Pay, +). */
  raised?: boolean;
}

export interface BottomNavProps {
  label: string;
  items: readonly BottomNavItem[];
  /** Extra classes, also the hook for e2e checks (`game-bottom-nav`). */
  className?: string;
}

/* The bar sits above the home indicator and the raised action overlaps it by 12px. */
const navClass = cx(
  'fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface-elevated shadow-lg',
  'pb-[max(var(--mb-space-2),var(--mb-app-safe-bottom))]',
  'glass-panel border-x-0 border-b-0',
);
const listClass =
  'mx-auto m-0 grid w-[min(100%,var(--mb-layout-content-max))] list-none items-end p-0 px-(--mb-space-2)';
const itemClass = cx(
  'relative flex min-h-[56px] w-full min-w-0 cursor-pointer flex-col items-center justify-center gap-[2px] rounded-control border-0 bg-transparent px-[2px] py-(--mb-space-1)',
  'font-ui text-[0.6875rem] leading-[1.15] font-semibold text-secondary',
  'focus-visible:outline-offset-[-2px] disabled:cursor-not-allowed disabled:opacity-60',
);
const activeItemClass = 'bg-surface-subtle text-primary';
const raisedClass = cx(
  'relative -mt-[12px] flex size-[56px] cursor-pointer flex-col items-center justify-center rounded-[50%] border-0',
  'bg-surface-inverse text-on-inverse shadow-md focus-visible:outline-offset-3',
  'disabled:cursor-not-allowed disabled:opacity-60 enabled:active:transform-[translateY(1px)]',
);
const badgeClass =
  'absolute -top-[2px] left-[calc(50%+4px)] grid min-h-[18px] min-w-[18px] place-items-center rounded-pill bg-danger px-[5px] text-[0.6875rem] leading-none font-bold text-on-danger';

/** Stroked 22px icon shell shared by every navigation destination. */
export function NavIcon({ children }: { children: ReactNode }) {
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

/** Bottom navigation: equal destinations plus at most one raised action, in the given order. */
export function BottomNav({ label, items, className }: BottomNavProps) {
  return (
    <nav className={cx(navClass, className)} aria-label={label}>
      <ul className={listClass} style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
        {items.map((item) => (
          <li
            key={item.key}
            className={item.raised === true ? 'grid justify-items-center' : 'grid'}
          >
            <button
              type="button"
              className={
                item.raised === true
                  ? cx(raisedClass, item.active === true && 'ring-2 ring-accent ring-offset-2')
                  : cx(itemClass, item.active === true && activeItemClass)
              }
              aria-current={item.active === true ? 'page' : undefined}
              disabled={item.disabled === true}
              onClick={item.onPress}
            >
              {item.icon}
              {item.raised === true ? (
                <span className="sr-only">{item.label}</span>
              ) : (
                <span className="max-w-full truncate">{item.label}</span>
              )}
              {item.badge !== undefined && item.badge.count > 0 && (
                <span className={badgeClass} role="status" aria-label={item.badge.label}>
                  {item.badge.count}
                </span>
              )}
            </button>
            {item.raised === true && (
              <span
                aria-hidden="true"
                className="text-[0.6875rem] leading-[1.15] font-semibold text-secondary"
              >
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
