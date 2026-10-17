import { Dialog as HeadlessDialog, DialogPanel, DialogTitle, Transition } from '@headlessui/react';
import {
  useContext,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { buttonCoreClass, buttonToneClass, cx, iconButtonShapeClass } from './ui/class-names';
import { DialogNavContext } from './dialog-nav-context';
import { Eyebrow } from './ui/Text';

interface DialogProps {
  title: string;
  children: ReactNode;
  onClose: () => void;
  closeLabel: string;
  eyebrow?: string;
  className?: string;
  closeDisabled?: boolean;
  presentation?: 'modal' | 'popover';
  /**
   * `browse` (default) keeps the game's bottom navigation under the sheet; `flow` is a step flow
   * (payment, build, trade, auction ...) whose sheet covers the navigation and the Pay button.
   */
  sheet?: 'browse' | 'flow';
  id?: string;
  popoverStyle?: CSSProperties;
}

/*
 * Entrance and exit motion, driven by the Headless UI `data-closed` state. From `md` up the centred panel
 * keeps each visual style's own travel (Classic 4px, Liquid Glass 5px). Below `md` every dialog
 * is a bottom sheet in both styles, so it slides up from the bottom edge instead.
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
  'classic:md:motion-safe:data-closed:translate-y-[4px] classic:md:motion-safe:data-closed:scale-99',
  'glass:md:motion-safe:data-closed:translate-y-[5px] glass:md:motion-safe:data-closed:scale-99',
  'max-md:motion-safe:data-closed:translate-y-full',
  'motion-reduce:transition-none',
);

/*
 * `dialog-backdrop(--modal|--popover)`, `dialog` and `dialog-close` stay as hooks for the e2e
 * suites, the unit tests and the settings-panel id lookup below.
 *
 * Below `md` the backdrop pins the panel to the bottom edge at full inline width and keeps only
 * the top safe-area gap; the panel itself pads for the side and bottom insets. Inside a game the
 * bottom navigation is rendered in the backdrop too (Headless UI makes the page outside the dialog
 * inert, so the bar must live in it to stay tappable); the sheet then stops above the bar.
 */
const backdropClass = cx(
  'dialog-backdrop glass-scrim fixed inset-0 z-100 grid place-items-center bg-overlay p-(--mb-space-6)',
  'max-md:[place-items:end_center] max-md:px-0 max-md:pt-[max(var(--mb-space-2),var(--mb-app-safe-top))] max-md:pb-(--mb-dialog-nav-offset)',
);
/* Liquid Glass blurs what sits behind the modal scrim; the settings scrim only below `md`. */
const backdropPresentationClass = {
  modal: '',
  popover: '',
};
/*
 * Below `md` the panel is the sheet: full width, rounded top only, no side or bottom border, a
 * `dvh`-bounded height under the top inset, safe-area padding, and a decorative grab handle. The
 * handle is absolutely placed, so it never becomes a grid item of the grid-laid panels.
 */
const sheetClass = cx(
  'max-md:relative max-md:max-h-[calc(100dvh_-_var(--mb-app-safe-top)_-_8px_-_var(--mb-dialog-nav-offset))] max-md:w-full max-md:rounded-b-none max-md:border-x-0 max-md:border-b-0',
  'max-md:[--mb-sheet-pad-bottom:max(var(--mb-space-5),calc(var(--mb-sheet-safe-bottom,var(--mb-app-safe-bottom))_+_14px))] max-md:pt-[24px] max-md:pr-[max(18px,var(--mb-app-safe-right))] max-md:pb-(--mb-sheet-pad-bottom) max-md:pl-[max(18px,var(--mb-app-safe-left))]',
  "max-md:before:absolute max-md:before:inset-x-0 max-md:before:top-[10px] max-md:before:mx-auto max-md:before:h-[4px] max-md:before:w-[42px] max-md:before:rounded-pill max-md:before:bg-border-strong max-md:before:content-['']",
);
const panelClass = cx(
  'dialog max-h-[calc(100dvh_-_48px)] overflow-auto rounded-xl border border-border bg-surface-elevated p-[clamp(var(--mb-space-5),4vw,var(--mb-space-7))] text-primary shadow-lg',
  sheetClass,
  'origin-center max-md:origin-bottom motion-reduce:transform-none!',
  '[&>header]:flex [&>header]:items-start [&>header]:justify-between [&>header]:border-b [&>header]:border-dialog-divider [&>header]:pb-(--mb-space-4) max-md:[&>header]:pb-(--mb-space-3)',
  '[&_h2]:font-display [&_h2]:text-primary [&>header_h2]:m-0 [&>header_h2]:text-heading-lg max-md:[&>header_h2]:text-[clamp(1.125rem,5vw,1.3125rem)]',
);
const presentationClass = {
  modal: cx(
    'w-[min(100%,640px)] [&>header]:gap-(--mb-space-5)',
    '[&_h2]:m-0 [&_h2]:text-heading-lg max-md:[&_h2]:text-[clamp(1.125rem,5vw,1.3125rem)] [&_h2]:leading-[1.2] [&_h2]:tracking-[-0.025em]',
    'glass-panel',
  ),
  // The settings panel; its Liquid Glass surface is in `App.tsx`.
  popover:
    'grid w-[min(calc(100vw_-_2_*_var(--mb-space-4)),23rem)] gap-(--mb-space-4) [&>header]:gap-(--mb-space-3)',
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
  sheet = 'browse',
  id,
  popoverStyle,
}: DialogProps) {
  // The dialog stays mounted for its leave transition; `onClose` runs once that has finished.
  const [open, setOpen] = useState(true);
  const bottomNav = useContext(DialogNavContext);
  const withNav = bottomNav !== null && presentation === 'modal' && sheet === 'browse';
  const requestClose = () => {
    if (!closeDisabled) setOpen(false);
  };
  // Headless UI blurs the focused control on Escape before closing; a locked dialog keeps focus.
  const keepFocusWhileLocked = (event: KeyboardEvent<HTMLElement>) => {
    if (closeDisabled && event.key === 'Escape') event.preventDefault();
  };

  return (
    <Transition show={open} appear afterLeave={onClose}>
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
        style={
          withNav
            ? ({
                '--mb-dialog-nav-offset': 'var(--mb-bottom-nav-height)',
                '--mb-sheet-safe-bottom': '0px',
              } as CSSProperties)
            : undefined
        }
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
              {eyebrow !== undefined && <Eyebrow>{eyebrow}</Eyebrow>}
              <DialogTitle>{title}</DialogTitle>
            </div>
            <button
              className={closeClass}
              type="button"
              onClick={requestClose}
              disabled={closeDisabled}
              aria-label={closeLabel}
            >
              ×
            </button>
          </header>
          {children}
        </DialogPanel>
        {withNav && bottomNav}
      </HeadlessDialog>
    </Transition>
  );
}
