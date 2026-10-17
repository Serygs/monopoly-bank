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

/*
 * A floating glass capsule: inset from the sides and the bottom (plus the home indicator), so the
 * page scrolls underneath it. `--mb-bottom-nav-height` (index.css) covers capsule + inset, which is
 * the clearance pages and sheets keep. The raised action is a circle inside its own column, so its
 * label shares the baseline of the other labels.
 */
const navClass = cx(
  'fixed inset-x-(--mb-bottom-nav-inset) bottom-[calc(var(--mb-bottom-nav-inset)+var(--mb-app-safe-bottom))] z-30',
  'mx-auto w-[min(calc(100%-2*var(--mb-bottom-nav-inset)),var(--mb-layout-content-max))] rounded-pill',
  'glass-panel border border-border bg-surface-elevated shadow-lg',
);
const listClass = 'm-0 grid list-none items-end p-0 px-(--mb-space-2)';
const itemClass = cx(
  'relative flex h-[60px] w-full min-w-0 cursor-pointer flex-col items-center justify-end gap-[2px] rounded-pill border-0 bg-transparent px-[2px] pt-(--mb-space-2) pb-(--mb-space-2)',
  'font-ui text-[0.6875rem] leading-[1.15] font-semibold text-secondary max-[380px]:text-[0.625rem]',
  'focus-visible:outline-offset-[-2px] disabled:cursor-not-allowed disabled:opacity-60',
);
const activeItemClass = 'bg-surface-subtle text-primary';
const raisedItemClass = 'overflow-visible text-secondary';
const raisedCircleClass = cx(
  'relative -mt-[14px] grid size-[48px] place-items-center rounded-[50%]',
  'bg-surface-inverse text-on-inverse shadow-md',
);
const badgeClass =
  'absolute top-[4px] left-[calc(50%+4px)] grid min-h-[16px] min-w-[16px] place-items-center rounded-pill bg-accent px-[4px] text-[0.625rem] leading-none font-bold text-on-accent';

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
  const columns = items.map((item) =>
    item.raised === true ? 'minmax(76px,1fr)' : 'minmax(0,1fr)',
  );
  return (
    <nav className={cx(navClass, className)} aria-label={label}>
      <ul className={listClass} style={{ gridTemplateColumns: columns.join(' ') }}>
        {items.map((item) => {
          const raised = item.raised === true;
          return (
            <li key={item.key} className="grid">
              <button
                type="button"
                className={cx(
                  itemClass,
                  raised ? raisedItemClass : item.active === true && activeItemClass,
                  raised && item.active === true && 'text-primary',
                )}
                aria-current={item.active === true ? 'page' : undefined}
                disabled={item.disabled === true}
                onClick={item.onPress}
              >
                {raised ? (
                  <span
                    className={cx(
                      raisedCircleClass,
                      item.active === true && 'ring-2 ring-accent ring-offset-2',
                    )}
                  >
                    {item.icon}
                  </span>
                ) : (
                  item.icon
                )}
                <span className="max-w-full truncate">{item.label}</span>
                {item.badge !== undefined && item.badge.count > 0 && (
                  <>
                    <span className={badgeClass} aria-hidden="true">
                      {item.badge.count}
                    </span>
                    <span className="sr-only">{item.badge.label}</span>
                  </>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
