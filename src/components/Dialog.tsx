import { Dialog as HeadlessDialog, DialogPanel, DialogTitle, Transition } from '@headlessui/react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { cx } from './ui/class-names';

interface DialogProps {
  title: string;
  children: ReactNode;
  onClose: () => void;
  closeLabel: string;
  eyebrow?: string;
  className?: string;
  closeDisabled?: boolean;
  presentation?: 'modal' | 'popover';
  id?: string;
  popoverStyle?: CSSProperties;
}

/*
 * Entrance motion, driven by the Headless UI `data-closed` state. The panel keeps each visual
 * style's own travel (Classic 4px, Liquid Glass 5px; Classic compact dialogs rise as a sheet).
 * Everything is gated on `motion-safe:`, so reduced motion has no closed state to animate from.
 */
const backdropMotion = cx(
  'motion-safe:transition-opacity motion-safe:duration-(--mb-duration-normal) motion-safe:ease-standard',
  'motion-safe:data-closed:opacity-0',
  'motion-reduce:transition-none',
);
const panelMotion = cx(
  'motion-safe:transition-[opacity,translate,scale] motion-safe:duration-(--mb-duration-normal) motion-safe:ease-emphasized',
  'motion-safe:data-closed:opacity-0',
  'classic:motion-safe:data-closed:translate-y-[4px] classic:motion-safe:data-closed:scale-99',
  'classic:max-md:motion-safe:data-closed:translate-y-(--mb-space-4) classic:max-md:motion-safe:data-closed:scale-100',
  'glass:motion-safe:data-closed:translate-y-[5px] glass:motion-safe:data-closed:scale-99',
  'motion-reduce:transition-none',
);

/**
 * Modal surface on Headless UI: it owns the focus trap, focus restoration, scroll lock, outside
 * click and Escape. The dialog element is the full-viewport backdrop; the `.dialog` panel inside
 * it is the visible surface. `popover` only changes the presentation classes and panel position.
 */
export function Dialog({
  title,
  children,
  onClose,
  closeLabel,
  eyebrow,
  className = '',
  closeDisabled = false,
  presentation = 'modal',
  id,
  popoverStyle,
}: DialogProps) {
  const requestClose = () => {
    if (!closeDisabled) onClose();
  };
  // Headless UI blurs the focused control on Escape before closing; a locked dialog keeps focus.
  const keepFocusWhileLocked = (event: KeyboardEvent<HTMLElement>) => {
    if (closeDisabled && event.key === 'Escape') event.preventDefault();
  };

  return (
    <Transition show appear>
      <HeadlessDialog
        id={id ?? (className.includes('settings-panel') ? 'settings-panel' : undefined)}
        // `autoFocus` (data-autofocus lookup) otherwise leaves focus on the dialog element; off, it
        // lands on the first enabled control, as the previous implementation did.
        autoFocus={false}
        onClose={requestClose}
        className={cx('dialog-backdrop', `dialog-backdrop--${presentation}`, backdropMotion)}
      >
        <DialogPanel
          as="section"
          transition
          className={cx('dialog', className, panelMotion)}
          style={presentation === 'popover' ? popoverStyle : undefined}
          onKeyDown={keepFocusWhileLocked}
        >
          <header>
            <div>
              {eyebrow !== undefined && <p className="eyebrow">{eyebrow}</p>}
              <DialogTitle>{title}</DialogTitle>
            </div>
            <button
              className="button button-quiet icon-button dialog-close"
              type="button"
              onClick={onClose}
              disabled={closeDisabled}
              aria-label={closeLabel}
            >
              ×
            </button>
          </header>
          {children}
        </DialogPanel>
      </HeadlessDialog>
    </Transition>
  );
}
