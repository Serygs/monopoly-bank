import { Dialog as HeadlessDialog, DialogPanel, DialogTitle, Transition } from '@headlessui/react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import {
  buttonCoreClass,
  buttonToneClass,
  cx,
  eyebrowClass,
  iconButtonShapeClass,
} from './ui/class-names';

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

/*
 * `dialog-backdrop(--modal|--popover)`, `dialog` and `dialog-close` stay as hooks for the e2e
 * suites, the unit tests and the settings-panel id lookup below.
 */
const backdropClass = cx(
  'dialog-backdrop fixed inset-0 z-100 grid place-items-center bg-overlay p-(--mb-space-6)',
  'max-md:[place-items:end_center] max-md:pt-[max(var(--mb-space-2),env(safe-area-inset-top))] max-md:pr-[max(var(--mb-space-2),env(safe-area-inset-right))] max-md:pb-0 max-md:pl-[max(var(--mb-space-2),env(safe-area-inset-left))]',
);
/* Liquid Glass blurs what sits behind the modal scrim; the settings scrim only below `md`. */
const backdropPresentationClass = {
  modal: 'glass:backdrop-blur-[8px] glass:backdrop-saturate-[0.9]',
  popover: 'glass:max-md:backdrop-blur-[6px] glass:max-md:backdrop-saturate-[0.92]',
};
const panelClass = cx(
  'dialog max-h-[calc(100dvh_-_48px)] overflow-auto rounded-xl border border-border bg-surface-elevated p-[clamp(var(--mb-space-5),4vw,var(--mb-space-7))] text-primary shadow-lg',
  'max-md:max-h-[calc(100dvh_-_env(safe-area-inset-top)_-_8px)] max-md:rounded-b-none',
  'max-md:pt-(--mb-space-5) max-md:pr-[max(18px,env(safe-area-inset-right))] max-md:pb-[max(var(--mb-space-5),calc(env(safe-area-inset-bottom)_+_14px))] max-md:pl-[max(18px,env(safe-area-inset-left))]',
  'origin-center classic:max-md:origin-bottom motion-reduce:transform-none!',
  '[&>header]:flex [&>header]:items-start [&>header]:justify-between [&>header]:border-b [&>header]:border-dialog-divider [&>header]:pb-(--mb-space-4)',
  '[&_h2]:font-display [&_h2]:text-primary [&>header_h2]:m-0 [&>header_h2]:text-heading-lg',
);
const presentationClass = {
  modal: cx(
    'w-[min(100%,640px)] max-md:w-full [&>header]:gap-(--mb-space-5)',
    '[&_h2]:m-0 [&_h2]:text-heading-lg [&_h2]:leading-[1.2] [&_h2]:tracking-[-0.025em]',
    'glass:border-[rgb(255_255_255/0.72)] glass:bg-[rgb(255_255_255/0.76)] glass:dark:border-[rgb(255_255_255/0.2)] glass:dark:bg-[rgb(32_40_52/0.9)]',
    'glass:shadow-[0_24px_64px_rgb(35_52_78/0.2),inset_0_1px_0_rgb(255_255_255/0.8)]',
    'glass:backdrop-blur-[26px] glass:backdrop-saturate-[1.3] glass:max-md:backdrop-blur-[24px] glass:max-md:backdrop-saturate-[1.24]',
    'glass:forced-colors:backdrop-filter-none',
  ),
  // The settings panel; its Liquid Glass surface is in `App.tsx`.
  popover:
    'grid w-[min(calc(100vw_-_2_*_var(--mb-space-4)),23rem)] gap-(--mb-space-4) max-md:w-full [&>header]:gap-(--mb-space-3)',
};
/* Liquid Glass tints the close button; the quiet hover and pressed states still win. */
const closeClass = cx(
  buttonCoreClass,
  buttonToneClass.quiet,
  iconButtonShapeClass,
  'dialog-close text-[1.55rem] leading-none',
  'glass:flex-none glass:bg-[color-mix(in_srgb,var(--mb-color-surface-subtle)_76%,transparent)] glass:text-primary',
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
        className={cx(
          backdropClass,
          `dialog-backdrop--${presentation}`,
          backdropPresentationClass[presentation],
          backdropMotion,
        )}
      >
        <DialogPanel
          as="section"
          transition
          className={cx(panelClass, presentationClass[presentation], className, panelMotion)}
          style={presentation === 'popover' ? popoverStyle : undefined}
          onKeyDown={keepFocusWhileLocked}
        >
          <header>
            <div>
              {eyebrow !== undefined && <p className={eyebrowClass}>{eyebrow}</p>}
              <DialogTitle>{title}</DialogTitle>
            </div>
            <button
              className={closeClass}
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
