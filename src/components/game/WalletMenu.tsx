import type { ReactNode } from 'react';
import { Button, Toggle } from '../ui';
import { cx } from '../ui/class-names';

/** One wallet action. `outgoing` is the only thing that turns it red: money leaves the wallet. */
export interface WalletMenuItem {
  key: string;
  label: string;
  outgoing?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export interface WalletMenuGroup {
  key: string;
  label: string;
  icon: string;
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

const tileClass =
  'min-h-16 justify-start rounded-control px-(--mb-space-4) py-[10px] text-left text-button leading-[1.15]';
const toneClass = (outgoing: boolean | undefined) =>
  outgoing === true ? 'border-danger-border bg-danger-soft text-danger' : '';

const groupClass = cx(
  'border-t border-border',
  '[&>summary]:flex [&>summary]:min-h-(--mb-control-height-md) [&>summary]:cursor-pointer [&>summary]:items-center [&>summary]:gap-(--mb-space-3)',
  '[&>summary]:py-(--mb-space-2) [&>summary]:font-bold [&>summary]:text-primary',
);

/**
 * The wallet action menu: four primary tiles, then collapsible groups. Red marks outgoing money
 * only; everything else is neutral, so colour never doubles as an action category.
 */
export function WalletMenu({ primary, exactGo, groups, children }: WalletMenuProps) {
  return (
    <div className="grid gap-(--mb-space-3)">
      <div className="grid grid-cols-2 gap-[10px]">
        {primary.map((item) => (
          <Button
            key={item.key}
            variant="secondary"
            className={cx(tileClass, toneClass(item.outgoing))}
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
                <span aria-hidden="true">{group.icon}</span>
                {group.label}
              </summary>
              <div className="grid grid-cols-2 gap-[10px] pb-(--mb-space-3) max-md:grid-cols-1">
                {group.items.map((item) => (
                  <Button
                    key={item.key}
                    variant="secondary"
                    className={cx(tileClass, toneClass(item.outgoing))}
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
