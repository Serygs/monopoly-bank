import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';

export interface OverflowMenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger';
}

export function OverflowMenu({ label, items }: { label: string; items: OverflowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const closeFromOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeFromOutside);
    document.addEventListener('keydown', closeFromKeyboard);
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside);
      document.removeEventListener('keydown', closeFromKeyboard);
    };
  }, [open]);

  const moveFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const enabledItems = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
    if (enabledItems.length === 0) return;
    event.preventDefault();
    const currentIndex = enabledItems.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? enabledItems.length - 1 : event.key === 'ArrowDown' ? (currentIndex + 1) % enabledItems.length : (currentIndex - 1 + enabledItems.length) % enabledItems.length;
    enabledItems[nextIndex]?.focus();
  };

  return <div className="overflow-menu" ref={rootRef}>
    <button ref={triggerRef} className="button button-secondary icon-button overflow-menu-trigger" type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((current) => !current)}>
      <span aria-hidden="true">•••</span>
    </button>
    {open && <div ref={menuRef} className="overflow-menu-panel" id={menuId} role="menu" onKeyDown={moveFocus}>
      {items.map((item) => <button key={item.label} className={`overflow-menu-item${item.tone === 'danger' ? ' overflow-menu-item-danger' : ''}`} type="button" role="menuitem" disabled={item.disabled} onClick={() => { setOpen(false); item.onSelect(); }}>{item.label}</button>)}
    </div>}
  </div>;
}
