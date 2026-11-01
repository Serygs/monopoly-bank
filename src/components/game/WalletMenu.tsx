import type { ReactNode } from 'react';
import { Button, Toggle } from '../ui';
import { cx } from '../ui/class-names';

export type WalletMenuIconName = 'property' | 'loans' | 'group' | 'fund';

/**
 * Which way the money moves for the wallet: `expense` (red) takes it out, `income` (green) brings
 * it in; an action that is neither (a trade, an auction) stays neutral.
 */
export type WalletMenuTone = 'expense' | 'income';

/** One wallet action. */
export interface WalletMenuItem {
  key: string;
  label: string;
  tone?: WalletMenuTone;
  disabled?: boolean;
  onSelect: () => void;
}

export interface WalletMenuGroup {
  key: string;
  label: string;
  icon: WalletMenuIconName;
  items: readonly WalletMenuItem[];
}

export interface WalletMenuProps {
  /** The four main tiles, in reading order. */
  primary: readonly WalletMenuItem[];
  /** Rendered under the main tiles, e.g. the exact-GO switch. */
  exactGo?: { label: string; checked: boolean; onChange: (checked: boolean) => void };
  /** Collapsible groups; a group without items is not rendered. */
  groups: readonly WalletMenuGroup[];
  /** Rendered after the groups, e.g. hints and the danger zone. */
  children?: ReactNode;
}

/** Line icons (20x20, current colour) for the collapsible groups. */
const iconPaths: Record<WalletMenuIconName, string> = {
  property: 'M3 9.5L10 4l7 5.5V16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM8 17v-5h4v5',
  loans:
    'M2.5 6h15v8h-15zM5.5 6a2 2 0 0 1-2 2M14.5 6a2 2 0 0 0 2 2M5.5 14a2 2 0 0 0-2-2M14.5 14a2 2 0 0 1 2-2M10 8.25a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5z',
  group:
    'M7.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM2.5 16c0-2.5 2.2-4.5 5-4.5s5 2 5 4.5M13.5 9a2.2 2.2 0 1 0 0-4.4M14.5 11.6c1.7.4 3 1.9 3 4',
  fund: 'M4 3.5h12a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1zM8 15V6h3a2.5 2.5 0 0 1 0 5H8',
};

function GroupIcon({ name }: { name: WalletMenuIconName }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="size-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={iconPaths[name]} />
    </svg>
  );
}

const tileClass = 'min-h-16 rounded-control px-(--mb-space-4) py-[10px] text-button leading-[1.15]';
const startAlignedClass = 'justify-start text-left';
/*
 * The tone replaces the secondary button's border, fill and text in every style (the Classic and
 * Liquid Glass secondary colours are variant classes, so the tone needs `!` to win over them).
 * The label still says what the action does; colour only adds the direction of the money.
 */
const toneClasses: Record<WalletMenuTone, string> = {
  expense: 'border-danger-border! bg-danger-soft! text-danger!',
  income: 'border-status-border! bg-status-surface! text-status-text!',
};
const toneClass = (tone: WalletMenuTone | undefined) =>
  tone === undefined ? '' : toneClasses[tone];

const groupClass = cx(
  'border-t border-border',
  '[&>summary]:flex [&>summary]:min-h-(--mb-control-height-md) [&>summary]:cursor-pointer [&>summary]:items-center [&>summary]:gap-(--mb-space-3)',
  '[&>summary]:py-(--mb-space-2) [&>summary]:font-bold [&>summary]:text-primary',
);

/**
 * The wallet action menu: the primary tiles, then collapsible groups. Red marks money leaving the
 * wallet, green money coming in; actions that move no money one way stay neutral.
 */
export function WalletMenu({ primary, exactGo, groups, children }: WalletMenuProps) {
  return (
    <div className="grid gap-(--mb-space-3)">
      <div className="grid grid-cols-2 gap-[10px]">
        {primary.map((item, index) => (
          <Button
            key={item.key}
            variant="secondary"
            className={cx(
              tileClass,
              toneClass(item.tone),
              // An odd count leaves the last tile alone in its row: it takes the whole row and
              // centres its label.
              primary.length % 2 === 1 && index === primary.length - 1
                ? 'col-span-2 justify-center text-center'
                : startAlignedClass,
            )}
            disabled={item.disabled === true}
            onClick={item.onSelect}
          >
            {item.label}
          </Button>
        ))}
      </div>
      {exactGo !== undefined && (
        <Toggle label={exactGo.label} checked={exactGo.checked} onChange={exactGo.onChange} />
      )}
      <div className="grid">
        {groups
          .filter((group) => group.items.length > 0)
          .map((group) => (
            <details key={group.key} className={groupClass}>
              <summary>
                <GroupIcon name={group.icon} />
                {group.label}
              </summary>
              <div className="grid grid-cols-2 gap-[10px] pb-(--mb-space-3) max-md:grid-cols-1">
                {group.items.map((item) => (
                  <Button
                    key={item.key}
                    variant="secondary"
                    className={cx(tileClass, startAlignedClass, toneClass(item.tone))}
                    disabled={item.disabled === true}
                    onClick={item.onSelect}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
            </details>
          ))}
      </div>
      {children}
    </div>
  );
}
