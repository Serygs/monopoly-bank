import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';

export interface OverflowMenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger';
}

/**
 * Contextual actions on Headless UI `Menu`: it owns opening from the keyboard, arrow/Home/End
 * navigation, type-ahead, outside-click and Escape dismissal, and focus return to the trigger.
 * The panel stays in place (no anchor/portal) so `.overflow-menu-panel` keeps its position, and
 * is non-modal so the page neither locks scrolling nor goes inert while it is open.
 */
export function OverflowMenu({ label, items }: { label: string; items: OverflowMenuItem[] }) {
  return (
    <Menu as="div" className="overflow-menu">
      <MenuButton
        className="button button-secondary icon-button overflow-menu-trigger"
        aria-label={label}
      >
        <span aria-hidden="true">•••</span>
      </MenuButton>
      <MenuItems className="overflow-menu-panel" modal={false}>
        {items.map((item) => (
          <MenuItem key={item.label} disabled={item.disabled}>
            <button
              className={`overflow-menu-item${item.tone === 'danger' ? ' overflow-menu-item-danger' : ''}`}
              type="button"
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
