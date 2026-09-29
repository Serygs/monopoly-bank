import { Transition } from '@headlessui/react';
import { useRef, type FocusEvent } from 'react';
import {
  buttonCoreClass,
  cx,
  iconButtonShapeClass,
  noticeToneClass,
  type NoticeTone,
} from './class-names';

export interface ToastProps {
  tone: NoticeTone;
  message: string;
  /** Accessible name of the close button, e.g. `t('dismissNotification')`. */
  closeLabel: string;
  onDismiss: () => void;
  /** Called when the pointer or keyboard focus first rests on the toast (WCAG 2.2.1). */
  onPause?: () => void;
  /** Called once neither the pointer nor focus is on the toast any more. */
  onResume?: () => void;
}

/*
 * Compact tone surface. It enters with the shared duration token under `motion-safe:` only; the
 * surrounding region owns `aria-live`, so the toast itself carries no role.
 */
const toastClass = cx(
  'pointer-events-auto flex w-full items-center gap-(--mb-space-2) rounded-card border shadow-lg',
  'py-(--mb-space-2) ps-(--mb-space-4) pe-(--mb-space-1) [&>p]:m-0 [&>p]:min-w-0 [&>p]:flex-1',
  'motion-safe:transition-[opacity,translate] motion-safe:duration-(--mb-duration-normal) motion-safe:ease-emphasized',
  'motion-safe:data-closed:-translate-y-(--mb-space-2) motion-safe:data-closed:opacity-0 motion-reduce:transition-none',
);
/* A quiet close button in the toast's own tone colour. */
const closeClass = cx(
  buttonCoreClass,
  iconButtonShapeClass,
  'flex-none border-transparent bg-transparent text-[1.4rem] leading-none text-inherit',
  'not-disabled:active:bg-[color-mix(in_srgb,currentColor_16%,transparent)] fine-pointer:not-disabled:hover:bg-[color-mix(in_srgb,currentColor_10%,transparent)]',
);

/**
 * One notification in `FeedbackProvider`'s region. Hovering it or moving focus into it holds its
 * auto-dismiss timer; the timer resumes with the remaining time once both have left.
 */
export function Toast({ tone, message, closeLabel, onDismiss, onPause, onResume }: ToastProps) {
  const holds = useRef({ pointer: false, focus: false });
  const hold = (source: 'pointer' | 'focus', active: boolean) => {
    const wasHeld = holds.current.pointer || holds.current.focus;
    holds.current[source] = active;
    const isHeld = holds.current.pointer || holds.current.focus;
    if (isHeld && !wasHeld) onPause?.();
    if (!isHeld && wasHeld) onResume?.();
  };
  const releaseFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) hold('focus', false);
  };

  return (
    <Transition show appear>
      <div
        className={cx(toastClass, noticeToneClass[tone])}
        data-tone={tone}
        onPointerEnter={() => hold('pointer', true)}
        onPointerLeave={() => hold('pointer', false)}
        onFocus={() => hold('focus', true)}
        onBlur={releaseFocus}
      >
        <p>{message}</p>
        <button type="button" className={closeClass} aria-label={closeLabel} onClick={onDismiss}>
          ×
        </button>
      </div>
    </Transition>
  );
}
