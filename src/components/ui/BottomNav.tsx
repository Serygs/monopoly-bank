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
  /** A neutral dot (no number, not an alert) for something waiting for the viewer, with its accessible name. */
  dot?: { label: string };
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
 * page scrolls underneath it. `--mb-bottom-nav-height` (index.css) covers capsule, inset and 16px of air, which is
 * the clearance pages and sheets keep. The raised action is a circle inside its own column, so its
 * label shares the baseline of the other labels.
 */
const navClass = cx(
  'fixed inset-x-(--mb-bottom-nav-inset) bottom-[max(var(--mb-bottom-nav-inset),var(--mb-app-safe-bottom))] z-30',
  'mx-auto w-[min(calc(100%-2*var(--mb-bottom-nav-inset)),var(--mb-layout-content-max))] rounded-pill',
  'glass-panel',
);
/* Content fades out above the capsule instead of being cut: capsule + inset + safe area tall, under the nav. */
const fadeClass =
  'pointer-events-none fixed inset-x-0 bottom-0 z-30 h-(--mb-bottom-nav-height) bg-linear-to-t from-canvas to-transparent';
const listClass = 'm-0 grid list-none items-end p-0 px-(--mb-space-2)';
const itemClass = cx(
  'relative flex h-[64px] w-full min-w-0 cursor-pointer flex-col items-center justify-end gap-[2px] rounded-pill border-0 bg-transparent px-[2px] pt-(--mb-space-2) pb-(--mb-space-2)',
  'font-ui text-[0.6875rem] leading-[1.15] font-semibold text-secondary max-[380px]:text-[0.625rem]',
  'focus-visible:outline-offset-[-2px] disabled:cursor-not-allowed disabled:opacity-60',
);
const activeItemClass = 'bg-surface-subtle text-primary';
const raisedItemClass = 'overflow-visible text-secondary';
const raisedCircleClass = cx(
  'relative -mt-[18px] grid size-[58px] place-items-center rounded-[50%] [&_svg]:size-[27px]',
  'bg-surface-inverse text-on-inverse shadow-md',
);
const dotClass =
  'absolute top-[8px] left-[calc(50%+6px)] size-[8px] rounded-pill bg-accent ring-2 ring-surface-elevated';

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
    item.raised === true ? 'minmax(88px,1fr)' : 'minmax(0,1fr)',
  );
  return (
    <>
      <div aria-hidden="true" className={fadeClass} />
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
                  {item.dot !== undefined && (
                    <>
                      <span className={dotClass} aria-hidden="true" />
                      <span className="sr-only">{item.dot.label}</span>
                    </>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
