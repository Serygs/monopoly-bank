import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';
import { buttonClass, cx } from './ui/class-names';

export interface OverflowMenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger';
}

/* `overflow-menu-trigger` stays as the hook for the game card's open-menu `:has()` rules. */
const triggerClass = cx(
  buttonClass('secondary', true),
  'overflow-menu-trigger w-(--mb-control-height-md) tracking-[0.08em]',
);
const panelClass = cx(
  'absolute top-[calc(100%_+_var(--mb-space-2))] right-0 z-20 grid min-w-44 origin-top-right',
  'rounded-control border border-border bg-surface-elevated p-(--mb-space-2) shadow-lg',
  'classic:animate-[classic-menu-in_var(--mb-duration-fast)_var(--mb-ease-emphasized)] motion-reduce:transform-none!',
);
/* Headless UI keeps focus on the menu and marks the keyboard/pointer-active item `data-focus`. */
const itemClass = cx(
  'min-h-(--mb-control-height-md) cursor-pointer rounded-[calc(var(--mb-radius-control)_-_3px)] border-0 bg-transparent px-(--mb-space-3) py-0',
  'text-start font-ui text-small leading-[1.2] font-semibold text-primary',
  'transition-[color,background-color] duration-(--mb-duration-fast) ease-standard',
  'disabled:cursor-not-allowed disabled:opacity-50',
  'data-focus:bg-surface-subtle fine-pointer:not-disabled:hover:bg-surface-subtle',
  'data-[tone=danger]:text-danger data-[tone=danger]:data-focus:bg-danger-soft fine-pointer:data-[tone=danger]:not-disabled:hover:bg-danger-soft',
);

/**
 * Contextual actions on Headless UI `Menu`: it owns opening from the keyboard, arrow/Home/End
 * navigation, type-ahead, outside-click and Escape dismissal, and focus return to the trigger.
 * The panel stays in place (no anchor/portal) so it keeps its position under the trigger, and
 * is non-modal so the page neither locks scrolling nor goes inert while it is open.
 */
export function OverflowMenu({ label, items }: { label: string; items: OverflowMenuItem[] }) {
  return (
    <Menu as="div" className="relative">
      <MenuButton className={triggerClass} aria-label={label}>
        <span aria-hidden="true">•••</span>
      </MenuButton>
      <MenuItems className={panelClass} modal={false}>
        {items.map((item) => (
          <MenuItem key={item.label} disabled={item.disabled}>
            <button
              className={itemClass}
              type="button"
              data-tone={item.tone === 'danger' ? 'danger' : undefined}
              disabled={item.disabled}
              onClick={item.onSelect}
            >
              {item.label}
            </button>
          </MenuItem>
        ))}
      </MenuItems>
    </Menu>
  );
}
